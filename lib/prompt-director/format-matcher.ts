// lib/prompt-director/format-matcher.ts
// Format matcher (specs/v2/07): texto libre del usuario → formato existente
// o propuesta de formato custom. Lo consumen el wizard (sembrar el plan) y
// el refinado (cuando la conversación se sale del catálogo).
// Patrón Gemini: fetch directo + responseMimeType JSON (como lib/campaigns/brief.ts).

import 'server-only';
import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';
import { CustomFormatSchema, type CustomFormat } from './custom-format-schema';
import { type CreativeGuidelines } from '@/lib/campaigns/guidelines';
import { plannerStyleBlocks, type VisualStyle } from './style-profiles';
import { stagingPlannerBlock, type PlannerProductFacts } from './inventory';
export { CustomFormatSchema, type CustomFormat };

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

export type MatcherFormat = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  // Duración default del formato: el matcher la usa para decidir si el
  // scenePrompt necesita timeline por segundos (guía Morphic §T).
  defaultDurationS?: number;
};
export type MatcherCharacter = { id: string; name: string; states?: string[] };
// Imagen de referencia para el matcher (multimodal): el modelo VE el producto
// y los personajes y escribe acciones fieles a lo que existe. label entra al
// texto del usuario para atar cada imagen a su rol.
export type MatcherImage = { mimeType: string; dataBase64: string; label: string };

// Tope del scenePrompt del matcher: holgado para timelines de 15s con diálogo.
// No es el límite duro (ese es el prompt compilado, 4000, que garantiza el
// compiler); solo evita strings patológicos y deja margen al andamiaje.
const SCENE_PROMPT_MAX = 3000;

// Tope de duración de UNA escena de secuencia: es un beat corto, no un clip
// suelto. El modelo a veces devuelve 15 (el máximo de un clip) para un beat
// trivial — un reveal de 15s sale lento y caro. Se clampa aquí.
const SCENE_MAX_DURATION_S = 12;

// Recorta en frontera de frase/palabra para no cortar a media palabra.
function clampToWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const dot = cut.lastIndexOf('. ');
  const space = cut.lastIndexOf(' ');
  const at = dot > max * 0.6 ? dot + 1 : space > 0 ? space : cut.length;
  return cut.slice(0, at).trim();
}

// Quita emojis (y selectores de variación / modificadores de tono) del prompt:
// el modelo de video los renderiza deforme y la marca no usa emojis (CLAUDE.md).
// Colapsa los espacios que deja, sin tocar saltos de línea (timelines).
function stripEmoji(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{200D}️]/gu, '')
    .replace(/[ \t]{2,}/g, ' ');
}

// PD-11: cada escena de una secuencia es un CLIP independiente y debe empezar en 0,
// pero el matcher a veces continúa el timeline GLOBAL del guion ("4-9s", "9-13s")
// pese a la regla del SYSTEM. Red determinista: un solo marcador → se quita (beat
// único, no necesita timeline); varios → se rebasan restando el offset del primero
// para que arranquen en 0. No-op si no hay marcadores o ya empiezan en 0.
function normalizeSceneTimeline(text: string): string {
  const re = /(\d{1,2})\s*-\s*(\d{1,2})\s*s\b/gi;
  const markers = [...text.matchAll(re)];
  if (markers.length === 0) return text;
  if (markers.length === 1) {
    return text.replace(/\s*\d{1,2}\s*-\s*\d{1,2}\s*s\s*:?\s*/i, ' ').replace(/\s{2,}/g, ' ').trim();
  }
  const offset = parseInt(markers[0][1], 10);
  if (offset === 0) return text;
  return text.replace(re, (_m, a: string, b: string) => `${parseInt(a, 10) - offset}-${parseInt(b, 10) - offset}s`);
}

// Saneo común del scenePrompt del modelo: no-string → null; quita emojis; rebasa
// los marcadores de tiempo (PD-11); recorta en frontera de palabra si excede el
// techo. null descarta la escena.
function sanitizeScenePrompt(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = normalizeSceneTimeline(stripEmoji(v)).trim();
  if (!t) return null;
  return t.length > SCENE_PROMPT_MAX ? clampToWord(t, SCENE_PROMPT_MAX) : t;
}

const InventedCharacterSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(300),
});

// Una escena de una secuencia: misma forma que un scenePrompt suelto, recortado
// con el mismo clamp. Sin scenePrompt valido, la escena es descartable.
const SceneSchema = z.object({
  scenePrompt: z.unknown().transform(sanitizeScenePrompt),
  // Una escena de secuencia es un beat corto: se clampa a SCENE_MAX_DURATION_S
  // aunque el modelo pida más (evita un beat de 15s lento y caro).
  durationS: z
    .number()
    .int()
    .min(4)
    .max(15)
    .nullable()
    .catch(null)
    .default(null)
    .transform((n) => (n == null ? null : Math.min(n, SCENE_MAX_DURATION_S))),
  sceneSummary: z.string().trim().min(1).max(300).nullable().catch(null).default(null),
  // Peso dramático del beat (P19): modula duración/cortes en el planner. El LLM
  // lo infiere; si falla o lo omite, cae a 'beat' (comportamiento default).
  beatRole: z.enum(['reveal', 'action', 'beat']).catch('beat').default('beat'),
  // P05: label EXACTO de un estado fisico del personaje listado, o null. Patron beatRole.
  characterStateHint: z.string().trim().nullable().catch(null).default(null),
});
export type MatchedScene = {
  scenePrompt: string;
  durationS: number | null;
  sceneSummary: string | null;
  beatRole: 'reveal' | 'action' | 'beat';
  characterStateHint: string | null;
};

const MatchSchema = z.object({
  // Eco de la idea, solo informativo: el plan usa formato/count/scenePrompt,
  // nunca esto. ANTES un `.max(2000)` SIN catch tiraba el match ENTERO cuando el
  // modelo eco-devolvía una idea larga (briefs estructurados >2000 chars) → 0
  // matches → throw → el plan caía al mix genérico. Ahora se recorta a 2000 y
  // nunca falla por longitud (mismo criterio que scenePrompt: conservar, no anular).
  ideaText: z.string().min(1).transform((s) => s.slice(0, 2000)).catch('idea'),
  formatId: z.string().nullable(),
  customFormat: CustomFormatSchema.nullable(),
  // Cuántos creativos pide la idea ("3 versiones de..."). Sin cantidad
  // explícita el matcher devuelve 1; el techo total del plan lo pone el planner.
  count: z.number().int().min(1).max(10).catch(1).default(1),
  // Concepto concreto de la idea en inglés: va directo al scenePrompt del
  // item para que el creativo refleje lo que el usuario escribió. Con varias
  // acciones o ≥8s puede traer timeline ("0-3s: ...") y diálogo guionizado, así
  // que es legítimamente largo. ANTES un `.max(1500).catch(null)` lo anulaba en
  // silencio y el planner lo cambiaba por una semilla genérica, tirando el guion
  // del usuario. Ahora se CONSERVA y, si excede el presupuesto, se recorta en
  // frontera de palabra — nunca a null (no-string sí cae a null). El techo duro
  // del prompt COMPILADO (4000) lo garantiza el compiler de Seedance.
  scenePrompt: z.unknown().transform(sanitizeScenePrompt).default(null),
  // Duración que la acción necesita (4-15s, 1 acción ≈ 4s). null = usar la
  // default del formato.
  durationS: z.number().int().min(4).max(15).nullable().catch(null).default(null),
  // Resumen de la acción en el idioma de la campaña: SOLO display en la UI
  // (el prompt al modelo va en inglés siempre).
  sceneSummary: z.string().trim().min(1).max(300).nullable().catch(null).default(null),
  // Secuencia: cuando la idea es un anuncio multi-escena ya guionizado, el
  // modelo la parte en N escenas cortas. Vacio = idea normal (un solo clip).
  // Una escena sin scenePrompt valido se descarta; max 8 escenas.
  scenes: z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((arr) =>
      arr.slice(0, 8).flatMap((item) => {
        const parsed = SceneSchema.safeParse(item);
        if (!parsed.success || parsed.data.scenePrompt === null) return [];
        return [{
          scenePrompt: parsed.data.scenePrompt,
          durationS: parsed.data.durationS,
          sceneSummary: parsed.data.sceneSummary,
          beatRole: parsed.data.beatRole,
          characterStateHint: parsed.data.characterStateHint,
        } satisfies MatchedScene];
      }),
    ),
  sequenceLabel: z.string().trim().min(1).max(120).nullable().catch(null).default(null),
  // P05 clip único: label EXACTO de un estado físico del personaje listado, o
  // null. Nivel idea (para ideas de un solo clip); las escenas de secuencia
  // usan su propio characterStateHint dentro de scenes[].
  characterStateHint: z.string().trim().nullable().catch(null).default(null),
  // PD-04: motivo legible cuando la idea es demasiado vaga para volverse una toma
  // concreta (ni nombra un formato). El wizard lo muestra y el item NO se crea, en
  // vez de descartar la idea en silencio. null = idea trabajable.
  blocker: z.string().trim().min(1).max(200).nullable().catch(null).default(null),
  // Personajes del pool mencionados en la idea (ids exactos; se sanean abajo).
  characterIds: z.array(z.string()).catch([]).default([]),
  // Nombres mencionados que NO están en el pool: apariencia inventada que el
  // planner inyecta en el scene_prompt (sin imagen de referencia). Se valida
  // elemento a elemento: uno malformado no tira el match.
  inventedCharacters: z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((arr) =>
      arr.flatMap((item) => {
        const parsed = InventedCharacterSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
});
// El envoltorio se valida laxo y cada match por separado: un match malformado
// se descarta sin tirar los demás (la salida del LLM es estocástica).
const LooseReplySchema = z.object({ matches: z.array(z.unknown()) });
export type MatcherResult = { matches: Array<z.infer<typeof MatchSchema>> };

// Algunas variantes del modelo envuelven el JSON en fences markdown aunque
// se pida application/json: extraer el cuerpo antes de parsear.
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function kebab(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const REF_VALUES = new Set(['product', 'character', 'packaging']);

// El LLM no siempre respeta la forma pedida: claves en español (registro,
// estiloDeCamara, ritmo) o campos faltantes. Normalizar antes de validar —
// que un sinónimo o un default no tire la idea del usuario.
function normalizeCustomFormat(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const o = value as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const slugSource = str(o.slug) ?? str(o.name) ?? str(o.nombre);
  if (!slugSource) return value; // sin nada usable: que lo rechace el schema
  const slug = kebab(slugSource);
  const fallbackName = slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const duration = typeof o.defaultDurationS === 'number' ? Math.round(o.defaultDurationS) : 8;
  const refs = (Array.isArray(o.requiredRefs) ? o.requiredRefs : [])
    .filter((r): r is string => typeof r === 'string' && REF_VALUES.has(r));
  return {
    slug,
    name: (str(o.name) ?? str(o.nombre) ?? fallbackName).slice(0, 80),
    description: (str(o.description) ?? str(o.descripcion) ?? '').slice(0, 300),
    register: (str(o.register) ?? str(o.registro) ?? '').slice(0, 200),
    cameraStyle: (str(o.cameraStyle) ?? str(o.estiloDeCamara) ?? str(o.camera_style) ?? '').slice(0, 200),
    pacing: (str(o.pacing) ?? str(o.ritmo) ?? '').slice(0, 120),
    requiredRefs: refs.length ? refs : ['product'],
    defaultDurationS: Math.min(15, Math.max(4, duration)),
    defaultAudio: typeof o.defaultAudio === 'boolean' ? o.defaultAudio : true,
  };
}

const GeminiResponseSchema = z.object({
  candidates: z
    .array(z.object({
      content: z.object({ parts: z.array(z.object({ text: z.string() })).optional() }).optional(),
    }))
    .min(1),
});

// El idioma del resumen sigue al de la campaña; el scenePrompt va en inglés siempre.
const SUMMARY_LANGUAGE: Record<'es' | 'en', string> = {
  es: 'en ESPAÑOL',
  en: 'in ENGLISH',
};

const SYSTEM = `Eres director creativo de una plataforma de anuncios con IA.
Recibes ideas de campaña en lenguaje natural y un catálogo de formatos.
Por cada idea distinta devuelve un match:
- Si encaja en un formato del catálogo: formatId con su slug EXACTO (la cadena
  corta tras "slug=", no el id largo) y customFormat null.
- Si NO encaja: formatId null y customFormat con EXACTAMENTE estas claves
  (claves en inglés, valores en español):
  {"slug":"kebab-case-sin-acentos","name":"Nombre del formato","description":"una línea: qué es",
  "register":"registro/tono","cameraStyle":"estilo de cámara","pacing":"ritmo",
  "requiredRefs":["product"],"defaultDurationS":8,"defaultAudio":true}
  requiredRefs es subconjunto de ["product","character","packaging"];
  defaultDurationS es un entero entre 4 y 15.
- count: cuántos creativos pide la idea. Cantidad explícita ("3 versiones")
  = ese número. Invitación abierta ("varios", "los que se te ocurran",
  "puedes generar más de una") = 2 o 3, a tu criterio. Sin señal, count = 1.
- durationS: los segundos que la acción NECESITA (entero 4-15; 1 acción ≈ 4s).
  Una acción simple = 4-6s; varias acciones/beats = más. null para usar la
  duración default del formato.
- scenePrompt: la acción concreta de la idea, en INGLÉS, con el producto como
  ancla. REGLA CLAVE: un clip = UNA toma continua — misma escena, misma locación,
  mismo sujeto; la cámara se MUEVE (dolly, pan, rack focus) pero NUNCA corta a
  otro lugar. Si el anuncio CAMBIA de escena/locación/sujeto/momento (un corte:
  de un selfie a la pantalla de un celular, a un cuadro en la pared, a una
  repisa…), NO cabe en un clip: parte en varias escenas (campo scenes, abajo).
  Usa scenePrompt (clip único) SOLO cuando todo transcurre en esa única toma
  continua. Si la
  acción es UNA sola y simple: 1-2 frases. Si esa toma continua tiene varios
  beats o durationS es 8 o más, estructúralo como timeline con marcadores de
  segundos que cubran exactamente durationS ("0-3s: ... 3-7s: ... 7-9s: ..."),
  una acción por tramo, TODOS en la misma escena, y el cierre con el producto
  protagonista. DIRECCIÓN DE CÁMARA: cada tramo (o la frase única) abre
  con un plano y, como máximo, UN movimiento de cámara, en terminología real de
  cine: tipo de plano (wide shot, medium shot, close-up, extreme close-up,
  over-the-shoulder, POV), movimiento (dolly in/out, tracking, pan, tilt, crane,
  handheld, steadicam, rack focus) y, si suma, el ángulo (low/high/eye-level).
  Una acción + un movimiento por toma — nunca dos movimientos en el mismo tramo.
  CÁMARA POR DEFECTO ESTÁTICA: empieza cada toma con la cámara fija (locked-off);
  muévela solo cuando un beat lo justifique y nombra el motivo junto al movimiento
  ("slow dolly in as she realizes", "pan to follow the can as it rolls"). Un
  movimiento decorativo sin motivo se ve barato; si no hay motivo, deja la cámara
  quieta.
  MOVIMIENTO DE ELEMENTOS: cuando un sujeto u objeto se DESPLAZA, nombra su
  dirección explícita (forward/backward, up/down, left-to-right, toward/away from
  camera), independiente del movimiento de cámara — no dejes que el modelo adivine
  el sentido (un coche que avanza vs da marcha atrás, un cohete que sube vs cae).
  El tramo de cierre va en plano cerrado del producto (close-up / product hero)
  con la etiqueta de frente. Ejemplo: "0-3s: medium shot, eye level — she lifts
  the can to camera. 3-7s: slow dolly in to close-up — she takes a sip and nods.
  7-9s: tight product close-up, shallow depth of field — the can rests, label
  forward". VISIBILIDAD: declara en POSITIVO qué se ve y qué no — "solo vemos
  su cara", "el producto de espaldas a cámara", "el celular de frente". No uses
  paréntesis débiles tipo "(desde su POV)" para insinuarlo; si es primera persona,
  dilo explícito ("vista en primera persona, solo se ven sus manos"). SPATIAL BLOCKING: when a scene has two or more subjects (or a clear spatial relationship between a subject and the set), state their blocking explicitly in the scenePrompt — each subject's relative position (left/right/foreground/background/between/behind), their orientation (facing camera-left/right or toward each other), and the key set anchor. This gives the model a stable floor plan so subjects do not drift or swap places between cuts. Keep it brief and woven into the prose, not a separate list.
  PRODUCTO INTOCABLE: nombra el producto de forma neutra ("the product" o su
  nombre) y dirige solo su posición, uso, prominencia en cuadro y encuadre.
  NUNCA re-describas sus atributos físicos — material, marco o sin marco,
  medidas, colores, proporciones ni el contenido impreso: esos viajan aparte
  desde la ficha del producto y cualquier redescripción tuya puede
  contradecirla (p.ej. "framed canvas" cuando el producto es un canvas sin
  marco, o "black and white photo" cuando el impreso es a color). Tampoco
  inventes variantes, tamaños ni contenido impreso que no veas en las
  referencias.
  ACCIÓN Y EMOCIÓN: nunca dejes un verbo abstracto sin desglosar.
  Convierte "baila", "celebra", "se ve triste", "se emociona" en 2-4 micro-acciones
  observables repartidas EN SECUENCIA por el tramo (no "él baila" → "dos asentimientos
  de cabeza, un giro de hombro, una flexión de rodilla, un chasquido de dedos"; no "se
  ve triste" → "baja la mirada a la mesa, traga saliva, luego suelta el aire"). Una sola
  señal por instante; nunca apiles varias a la vez en el mismo momento (no "ojos muy
  abiertos + mano en la boca + lágrimas" simultáneos), que sale falso. Pero no te
  pases al otro extremo: describe cada acción por su INTENCIÓN y RESULTADO visible
  ("destapa la botella y la deja en la mesa"), nunca por su biomecánica articular
  ("la mano derecha rota la tapa en sentido antihorario mientras la izquierda
  estabiliza"); el modelo resuelve el CÓMO con su prior físico y sobre-detallar la
  mecánica (qué músculo, qué ángulo, qué articulación) genera artefactos.
 BEAT DE ACTUACIÓN POR TRAMO: cada tramo lleva UN beat de actuación
  concreto y observable — un gesto O una dirección de mirada O una respiración/
  micro-pausa (no los tres a la vez): "inhala", "baja la mirada a la mesa",
  "fija los ojos en cámara". Encadénalos EN SECUENCIA por el timeline, una señal
  por instante; nunca apiles varias en el mismo momento (eso es sobreactuar y se
  ve falso). Por defecto contenido, no histriónico.
  SONIDO: nombra el sonido diegético clave de cada tramo, breve y
  concreto (el fizz al abrir la lata, pasos sobre grava, el murmullo del café),
  porque el modelo genera audio nativo y nombrar el sonido lo mejora; nunca
  escribas "agrega música". Diálogo: SOLO si el usuario pide que alguien hable o
  da las líneas — en ese caso guionízalo dentro de cada tramo entre comillas
  (Dialogue: "...") __SUMMARY_LANG__, corto y conversacional, como se le habla
  a un amigo, nunca como locutor. HABLANTE: si hay 2 o más personajes del Cast en
  cámara, nombra QUIÉN dice cada línea (ej. "Pedro, a cámara: ...") y deja claro
  que el otro NO habla en ese tramo (sonríe, asiente) — así el modelo sincroniza
  una sola boca, no las dos. Si el usuario NO pidió diálogo, no lo
  inventes. Si recibes imágenes adjuntas (producto y personajes), describe la
  acción usando lo que VES: colores, materiales, contexto físico real del
  producto y apariencia real de los personajes. Cuando un personaje del Cast ACTÚA en
  cámara, nómbralo por su nombre propio en el scenePrompt (no "she" ni "the
  woman"): su identidad viaja como referencia viva del clip. Si la idea solo nombra un
  formato sin acción concreta ("quiero unboxings"), scenePrompt = null.
- scenes: SIEMPRE que el anuncio tenga MÁS DE UNA escena/plano distinto —
  locaciones distintas, cortes entre sujetos, saltos de tiempo, o un guión con
  varios momentos— pártela en escenas, UNA por clip. Cada generación es una toma
  continua y NO puede cortar de un escenario a otro, así que cada escena distinta
  necesita su propio clip. Esto aplica AUNQUE el total quepa en 15s: p. ej. 4
  momentos en 4 lugares = 4 clips, no un clip de 15s con cortes internos (eso
  sale incoherente). Solo deja UN clip cuando de verdad es una única toma
  continua. Cada escena es un objeto corto, un clip INDEPENDIENTE:
  {"scenePrompt":"accion concreta en INGLES de esta escena, AUTO-CONTENIDA
  (re-describe escenario y personaje —nombra al personaje del Cast por su nombre
  propio si actúa—, el modelo no recuerda entre clips), UNA
  sola toma continua que abre con su plano y UN movimiento de camara en
  terminologia real (wide/medium/close-up; dolly in, tracking, pan, rack focus)
  y, si es el cierre, plano cerrado del producto. NO copies los marcadores de
  tiempo del guion original (nada de '13-15s:'): cada escena empieza en 0 y, si
  es un solo beat, no necesita timeline",
  "durationS":"AJUSTA al tiempo que toma DECIR la linea de dialogo de ESA escena
  (o la accion si no hay dialogo): una frase corta = 4-5s, una mas larga hasta 8;
  un beat 'reveal' sostenido puede llegar a 12. entero 4-12. NUNCA infles una
  linea corta — el modelo rellena el silencio repitiendo palabras y el clip se
  traba","sceneSummary":"resumen __SUMMARY_LANG__,
  1 frase","beatRole":"el peso dramático de la escena: 'reveal' (una
  revelación, una confesión, un cambio emocional que aterriza — pídela como UN
  plano sostenido, sin cortes internos, con aire/silencio, y dale más segundos
  (hasta 12); minimiza el movimiento de cámara), 'action' (acción física rápida —
  cortes cortos, beats breves, 4-5s), o 'beat' (cualquier otra, ritmo normal).
  Si dudas, 'beat'","characterStateHint":"Si en esta escena un personaje del Cast
  está en un ESTADO FÍSICO listado entre paréntesis junto a su nombre
  (estados: sudado, mojado…), pon ese label EXACTO aquí; si no aplica o no hay
  estados listados, null"}.
  Maximo 8 escenas. Si NO es multi-escena, scenes = [] y usa scenePrompt normal.
- sequenceLabel: titulo corto del anuncio cuando devuelves scenes (ej. "Cuadro
  familiar"); null si scenes = [].
- sceneSummary: resumen de la acción para mostrar en la interfaz, __SUMMARY_LANG__,
  1 frase, máximo 200 caracteres, sin marcadores de segundos. Si scenePrompt es
  null, sceneSummary = null.
- characterStateHint: para una idea de UN SOLO CLIP (scenes = []), si la acción
  describe a un personaje del Cast en uno de sus ESTADOS FÍSICOS listados entre
  paréntesis junto a su nombre (estados: sudado, mojado…), pon ese label EXACTO;
  si no aplica, no hay estados listados, o la idea es multi-escena, null.
- characterIds: si la idea nombra personajes del Cast listado abajo, devuelve sus
  ids exactos (máximo 3). Si no nombra a nadie, [].
- inventedCharacters: si la idea nombra a una persona que NO está en el Cast,
  inventa su apariencia: {"name":"...","description":"apariencia concreta en
  INGLÉS, 1-2 frases, sin mencionar edad"}. No inventes personajes que la idea
  no menciona. Si no aplica, [].
- blocker: SOLO si una idea es demasiado vaga o ambigua para convertirla en una
  toma concreta (y ni siquiera nombra un formato), pon UNA línea __SUMMARY_LANG__
  diciendo qué falta (ej. "no dice qué pasa en pantalla ni qué formato quieres");
  deja formatId, customFormat y scenePrompt en null. Si la idea SÍ es trabajable,
  blocker = null. No lo uses como excusa para saltarte ideas que sí puedes resolver.
NUNCA escribas texto en pantalla (subtítulos, carteles, "Text on screen", copy
escrito) ni emojis dentro de scenePrompt ni en scenes: el modelo de video los
renderiza deforme y la marca no usa emojis. La acción describe lo que se VE y
se OYE; el copy y el CTA no van dentro del video. Para evitar texto generado,
describe las superficies en POSITIVO (paredes y mesas lisas y limpias, empaque sin
sobreimpresos) y encuadra fuera de letreros, en lugar de solo prohibirlo.
Nunca inventes atributos del producto. Devuelve SOLO el JSON:
{"matches":[{"ideaText":"...","formatId":"...|null","customFormat":{...}|null,"count":1,"durationS":null,"scenePrompt":"...|null","sceneSummary":"...|null","scenes":[],"sequenceLabel":null,"blocker":null,"characterIds":[],"inventedCharacters":[]}]}`;

// Helper puro (sin IO) que arma el SYSTEM prompt del matcher.
// Permite añadir condicionalmente las clausulas de guias creativas.
// `safeCrop` NO va aqui — es composicion pura del compilador.
export function buildMatcherSystemPrompt(opts: {
  language?: 'es' | 'en';
  guidelines?: CreativeGuidelines;
  visualStyle?: VisualStyle;
  visualStyleCustom?: string;
  product?: PlannerProductFacts;
}): string {
  const lang = opts.language ?? 'es';
  let system = SYSTEM.replaceAll('__SUMMARY_LANG__', SUMMARY_LANGUAGE[lang]);

  if (opts.guidelines?.showFullProduct) {
    system +=
      '\nPrioriza encuadres que muestren el producto COMPLETO; evita close-ups extremos que lo recorten, salvo una toma de detalle deliberada.';
  }
  if (opts.guidelines?.hookProductHero) {
    system +=
      '\nEl primer beat (hook) debe encuadrar el producto completo como protagonista (héroe), a tamaño grande.';
  }

  // Perfil de estilo de la campaña: bloque de autoría + física gateada por perfil.
  // El "cuadro volando" se corrige en el ORIGEN — el planner escribe scenePrompts
  // con objetos anclados. Fantasía relaja la física (groundedPhysics: false).
  // Misma política que el asistente de refinado (plannerStyleBlocks compartido).
  system += plannerStyleBlocks(opts.visualStyle, opts.visualStyleCustom);

  // Producto físico (spec 2026-07-02): staging proporcional + peso. Los
  // scenePrompt nacen con la pieza montada donde reposa naturalmente y con la
  // interacción acorde a su peso — el compiler solo refuerza, no corrige.
  system += stagingPlannerBlock(opts.product);

  return system;
}

export async function matchIdeas(input: {
  ideasText: string;
  formats: MatcherFormat[];
  characters?: MatcherCharacter[];
  // Imágenes reales de producto/personajes: opcionales y best-effort (sin
  // ellas el matcher trabaja solo con texto, como antes).
  images?: MatcherImage[];
  // Idioma del sceneSummary (display). Default 'es'.
  language?: 'es' | 'en';
  // Guias creativas de la campana: inyectadas en el system prompt del matcher.
  guidelines?: CreativeGuidelines;
  // Perfil de estilo visual de la campaña: gatea el bloque de autoría + física
  // del planner (buildMatcherSystemPrompt).
  visualStyle?: VisualStyle;
  visualStyleCustom?: string;
  // Datos físicos del producto: gatean el staging proporcional + peso del
  // planner (buildMatcherSystemPrompt).
  product?: PlannerProductFacts;
  // Pausa antes del único reintento (tests pasan 0). El matcher corre justo
  // después del brief (otra llamada a Gemini): un 429 puntual no debe
  // degradar el plan dirigido a mix genérico.
  retryDelayMs?: number;
}): Promise<MatcherResult> {
  try {
    return await requestMatch(input);
  } catch (err) {
    if (err instanceof ProviderError && err.retryable) {
      await new Promise((resolve) => setTimeout(resolve, input.retryDelayMs ?? 2000));
      return requestMatch(input);
    }
    throw err;
  }
}

async function requestMatch(input: {
  ideasText: string;
  formats: MatcherFormat[];
  characters?: MatcherCharacter[];
  images?: MatcherImage[];
  language?: 'es' | 'en';
  guidelines?: CreativeGuidelines;
  visualStyle?: VisualStyle;
  visualStyleCustom?: string;
  product?: PlannerProductFacts;
}): Promise<MatcherResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);

  const catalog = input.formats
    .map((f) =>
      `- id=${f.id} slug=${f.slug} "${f.name}"${f.defaultDurationS ? ` (${f.defaultDurationS}s)` : ''}: ${f.description ?? ''}`,
    )
    .join('\n');

  const system = buildMatcherSystemPrompt({
    language: input.language,
    guidelines: input.guidelines,
    visualStyle: input.visualStyle,
    visualStyleCustom: input.visualStyleCustom,
    product: input.product,
  });

  const cast = (input.characters ?? [])
    .map((c) => `- id=${c.id} ${c.name}${c.states?.length ? ` (estados: ${c.states.join(', ')})` : ''}`)
    .join('\n') || '(ninguno)';

  // Multimodal: las imágenes van después del texto, con sus roles declarados
  // en el texto para que el modelo sepa qué es cada una.
  const images = (input.images ?? []).slice(0, 4);
  const imageNote = images.length
    ? `\n\nImágenes adjuntas (en orden): ${images.map((img, i) => `${i + 1}=${img.label}`).join(', ')}.`
    : '';
  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [
    { text: `Catálogo:\n${catalog}\n\nCast de la campaña:\n${cast}\n\nIdeas del usuario:\n${input.ideasText.slice(0, 6000)}${imageNote}` },
    ...images.map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.dataBase64 } })),
  ];

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        // Timelines con diálogo por idea abultan el JSON: techo holgado para
        // que no se trunque (el saneo igual tolera truncados con retry).
        maxOutputTokens: 4000,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (res.status === 429) throw new ProviderError('Rate limit Gemini', 'rate_limit', true);
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('Auth inválida con Gemini API', 'auth', false);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`Gemini matcher ${res.status}: ${text.slice(0, 200)}`, 'server', res.status >= 500);
  }

  // De aquí en adelante los fallos son de la GENERACIÓN (truncada, fences,
  // campos malos): estocásticos, así que retryable=true — el reintento de
  // matchIdeas suele resolverlos. El detalle va al mensaje para que el log
  // del server muestre qué llegó.
  const envelope = GeminiResponseSchema.safeParse(await res.json());
  if (!envelope.success) {
    throw new ProviderError('Respuesta inesperada de Gemini en matcher', 'unknown', true);
  }
  const raw = (envelope.data.candidates[0].content?.parts ?? []).map((p) => p.text).join('');
  let json: unknown;
  try { json = JSON.parse(extractJson(raw)); } catch {
    throw new ProviderError(
      `Gemini devolvió JSON inválido en matcher: ${raw.slice(0, 180)}`, 'unknown', true,
    );
  }
  const loose = LooseReplySchema.safeParse(json);
  if (!loose.success) {
    throw new ProviderError(
      `Matcher sin lista de matches: ${raw.slice(0, 180)}`, 'unknown', true,
    );
  }
  const matches = loose.data.matches
    .slice(0, 8)
    .flatMap((m) => {
      const candidate = m && typeof m === 'object'
        ? {
            ...(m as Record<string, unknown>),
            customFormat: normalizeCustomFormat((m as Record<string, unknown>).customFormat ?? null),
          }
        : m;
      const parsed = MatchSchema.safeParse(candidate);
      return parsed.success ? [parsed.data] : [];
    });
  if (matches.length === 0) {
    throw new ProviderError(
      `Matcher sin matches válidos: ${raw.slice(0, 180)}`, 'unknown', true,
    );
  }

  // Saneo del formatId contra el catálogo. El modelo reproduce mal los UUID
  // (sobre todo en ideas multi-escena, más largas) y a veces devuelve el slug;
  // aceptamos id O slug y normalizamos al UUID canónico. Sin esto, un formatId no
  // exacto sin customFormat se descartaba en silencio aguas abajo → sin_match.
  // characterIds se filtra contra el pool y se recorta a 3 máximo.
  const known = new Set(input.formats.map((f) => f.id));
  const idBySlug = new Map(input.formats.map((f) => [f.slug, f.id]));
  const knownCharacters = new Set((input.characters ?? []).map((c) => c.id));
  return {
    matches: matches.map((m) => ({
      ...m,
      formatId: m.formatId
        ? known.has(m.formatId)
          ? m.formatId
          : (idBySlug.get(m.formatId) ?? null)
        : null,
      characterIds: [...new Set(m.characterIds.filter((id) => knownCharacters.has(id)))].slice(0, 3),
    })),
  };
}
