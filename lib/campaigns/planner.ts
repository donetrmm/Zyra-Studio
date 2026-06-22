// Planner de campaña (specs/v2/03 tarea 3). DETERMINISTA y puro: sin DB ni
// APIs — recibe formatos, escenas y cast, devuelve los items del plan.
// La server action persiste y el Prompt Director valida/compila al encolar.

import type { ProductCategory } from './brief';
import { buildCaption, type CaptionGoal } from './captions';
import { extractDialogue, estimateSpeechSeconds, fitVerdict, DUR_MAX } from './speech-fit';

export type PlannerFormat = {
  id: string;
  slug: string;
  name: string;
  requiredRefs: string[];
  defaultDurationS: number;
  defaultAudio: boolean;
};

export type PlannerScene = { name: string; fragment: string };
export type PlannerCharacter = { id: string; name: string };

export type PlannerInput = {
  totalItems: number;
  category: ProductCategory;
  productName: string;
  goal: CaptionGoal;
  formats: PlannerFormat[];
  scenes: PlannerScene[];
  characters: PlannerCharacter[];
  // Qué referencias existen en el Brand Kit/Cast: el plan nunca propone un
  // formato cuyos required_refs no se pueden cumplir (evita items bloqueados).
  // Nota: `character` se eliminó — el personaje puede inventarse en el prompt,
  // por lo que nunca bloquea un formato (spec 2026-06-12).
  available: { product: boolean; packaging: boolean };
  // Ciclo de aprendizaje (doc V2 §4.1 etapa 5): slugs de formatos con
  // creativos ganadores o plantillas destiladas — reciben doble peso en el mix.
  winningSlugs?: string[];
  dateStart: Date;
  dateEnd: Date;
  draftModelSlug: string;
  // Idioma de la campaña: decide el idioma del sceneSummary (033).
  language: 'es' | 'en';
  // Formato de video de la campaña (034): aplica a todos los items del plan.
  aspectRatio: string;
};

export type PlanItemDraft = {
  formatId: string;
  formatSlug: string;
  modelSlug: string;
  durationS: number;
  aspectRatio: string;
  scene: string;            // fragment de la escena (va al contexto del compile)
  audio: boolean;
  // orden = orden de referencias del prompt; [0] es el personaje principal.
  // Array vacío cuando el formato no necesita personaje o el pool está vacío y
  // se resuelve con el DEFAULT_PRESENTER inyectado en scenePrompt.
  characterIds: string[];
  scenePrompt: string;
  // Resumen de la acción en el idioma de la campaña: SOLO display (migración
  // 033). null cuando el idioma es inglés — la UI cae a scenePrompt.
  sceneSummary: string | null;
  caption: string;          // metadato de publicación (gancho + CTA + tags)
  scheduledDate: string;    // YYYY-MM-DD
  // Secuencia: null en creativos normales. Cuando != null, las escenas de un
  // mismo anuncio comparten sequenceId y se ordenan por sceneIndex.
  sequenceId: string | null;
  sceneIndex: number | null;
  sequenceLabel: string | null;
};

// Presentador inventado cuando el formato pide personaje y la campaña no
// asignó ninguno (spec 2026-06-12): solo texto, sin imagen — coherencia
// razonable, no identidad garantizada.
export const DEFAULT_PRESENTER =
  'a presenter with shoulder-length dark hair, neutral casual wardrobe and a warm confident delivery';

// Mix de formatos por categoría — mapa PROPIO (doc V2: no copiar relevance
// maps de terceros). El núcleo universal funciona para casi todo; cada
// categoría suma los formatos que su producto soporta de verdad.
const UNIVERSAL = ['voz-cercana', 'el-icono', 'gran-pantalla', 'mundo-imposible'];
const CATEGORY_MIX: Record<ProductCategory, string[]> = {
  beverage: [...UNIVERSAL, 'susurro', 'a-pie-de-calle'],
  food: [...UNIVERSAL, 'susurro', 'manos-a-la-obra', 'a-pie-de-calle'],
  beauty: [...UNIVERSAL, 'manos-a-la-obra', 'antes-y-despues', 'el-descubrimiento'],
  apparel: [...UNIVERSAL, 'antes-y-despues', 'el-descubrimiento', 'a-pie-de-calle'],
  accessories: [...UNIVERSAL, 'el-descubrimiento', 'a-pie-de-calle'],
  electronics: [...UNIVERSAL, 'manos-a-la-obra', 'el-descubrimiento'],
  // Sin producto físico: ni héroe kinético ni unboxing.
  software: ['voz-cercana', 'manos-a-la-obra', 'gran-pantalla', 'mundo-imposible'],
  home: [...UNIVERSAL, 'manos-a-la-obra', 'el-descubrimiento'],
  fitness: [...UNIVERSAL, 'antes-y-despues', 'a-pie-de-calle'],
  other: [...UNIVERSAL, 'a-pie-de-calle'],
};

// Semillas de concepto por formato — variar escenas dentro del mismo formato
// para que no haya dos videos iguales. Heurísticas propias; los formatos
// custom (slug desconocido) usan las genéricas.
type Seed = (p: { product: string; scene: string }) => string;
const GENERIC_SEEDS: Seed[] = [
  ({ product }) => `The ${product} is presented naturally within the scene, handled with ease, ending with the label facing the camera`,
  ({ product }) => `A quiet moment builds curiosity, then the ${product} takes the center of the frame as the clear focus`,
  ({ product }) => `The scene opens mid-action and resolves on the ${product} placed deliberately, catching the light`,
];
const CONCEPT_SEEDS: Record<string, Seed[]> = {
  // Todas las semillas describen al presentador HABLANDO a cámara: usan verbos
  // de habla (speaking/says) para que el compiler active de forma consistente la
  // dirección de lip sync — antes solo la primera lo hacía y el talking-head
  // salía sin sincronía de labios según la semilla que tocara.
  'voz-cercana': [
    ({ product }) => `The presenter holds the ${product} at chest height, tilts it toward the camera while speaking one casual line, takes a sip and reacts with an honest nod`,
    ({ product }) => `The presenter looks to camera, lifts the ${product} into frame, says a one-sentence personal take and smiles at the end`,
    ({ product }) => `Mid-routine, the presenter pauses, grabs the ${product}, shows it to camera and says a quick genuine recommendation`,
  ],
  'a-pie-de-calle': [
    ({ product }) => `The interviewer asks a passerby one quick question, hands over the ${product}, and captures the spontaneous first reaction`,
    ({ product }) => `A stranger is asked to rate the ${product} out of ten on camera, tries it and gives a verdict with a laugh`,
  ],
  'manos-a-la-obra': [
    ({ product }) => `Hands demonstrate the ${product} in three clear steps, each step framed tightly, ending with the finished result`,
    ({ product }) => `Top-down view: hands prepare and use the ${product} with deliberate confident movements, no wasted motion`,
  ],
  'el-descubrimiento': [
    ({ product }) => `The sealed package rests closed; hands open it slowly, lift the ${product} out and hold it up as the reveal`,
    ({ product }) => `Close-up on the seal breaking, paper folding back, and the ${product} emerging into soft light`,
  ],
  'antes-y-despues': [
    ({ product }) => `The frame holds the before state, a clean transition sweeps across, and the after state with the ${product} present tells the difference`,
    ({ product }) => `Identical framing in two beats: the situation without, then visibly transformed with the ${product} in frame`,
  ],
  susurro: [
    ({ product }) => `Macro close-up: the ${product} is opened slowly, every sound audible — the grip, the release, the settle on the surface`,
    ({ product }) => `Condensation and texture in extreme close-up; the ${product} is lifted, tilted and set down with soft audible contact`,
  ],
  'el-icono': [
    ({ product }) => `The ${product} spins on its axis against a bold minimal backdrop and stops with the label perfectly forward`,
    ({ product }) => `The ${product} drops into frame in slow motion, impact ripples outward, camera orbits once around it`,
  ],
  'gran-pantalla': [
    ({ product }) => `An establishing shot sets the mood, the ${product} enters as the natural protagonist of the moment, and the final frame holds on it with intent`,
    ({ product }) => `A composed scene unfolds around a quiet emotional beat; the ${product} anchors the resolution in the closing frame`,
  ],
  'mundo-imposible': [
    ({ product }) => `The ${product} appears at impossible scale within the scene, integrated into the environment as if it always belonged there`,
    ({ product }) => `Physics bend around the ${product}: the environment reacts to it in a surreal but coherent way, product always the anchor`,
  ],
};

// Resúmenes en español de las semillas, paralelos 1:1 por índice (033): el
// scenePrompt va en inglés al modelo; esto es lo que ve el usuario cuando la
// campaña está en español. Formatos custom (slug desconocido) usan los genéricos.
const GENERIC_SUMMARIES_ES: string[] = [
  'El producto se presenta con naturalidad en la escena y cierra con la etiqueta de frente a cámara',
  'Un momento de calma crea curiosidad y el producto toma el centro del cuadro',
  'La escena abre en plena acción y resuelve sobre el producto bañado por la luz',
];
const CONCEPT_SUMMARIES_ES: Record<string, string[]> = {
  'voz-cercana': [
    'El presentador muestra el producto a cámara, lo prueba y reacciona con un gesto honesto',
    'El presentador mira a cámara, alza el producto y comparte una opinión personal en una frase',
    'En plena rutina, el presentador toma el producto, lo muestra y da una recomendación rápida',
  ],
  'a-pie-de-calle': [
    'Entrevista en la calle: un transeúnte prueba el producto y captura su primera reacción espontánea',
    'Un desconocido califica el producto del 1 al 10 frente a cámara y da su veredicto entre risas',
  ],
  'manos-a-la-obra': [
    'Manos demuestran el producto en tres pasos claros hasta el resultado final',
    'Vista cenital: manos preparan y usan el producto con movimientos seguros y precisos',
  ],
  'el-descubrimiento': [
    'El paquete sellado se abre lentamente y el producto se revela en alto',
    'Primer plano del sello abriéndose y el producto emergiendo a la luz suave',
  ],
  'antes-y-despues': [
    'El antes, una transición limpia, y el después con el producto marcando la diferencia',
    'Mismo encuadre en dos tiempos: la situación sin el producto y transformada con él',
  ],
  susurro: [
    'Macro ASMR: el producto se abre lentamente con cada sonido audible',
    'Condensación y textura en primer plano extremo; el producto se alza y se posa con un toque suave',
  ],
  'el-icono': [
    'El producto gira sobre su eje en un fondo audaz y se detiene con la etiqueta de frente',
    'El producto cae a cuadro en cámara lenta y la cámara lo orbita una vez',
  ],
  'gran-pantalla': [
    'Un plano de apertura marca el tono y el producto protagoniza el cierre',
    'Una escena compuesta alrededor de un beat emocional; el producto ancla la resolución',
  ],
  'mundo-imposible': [
    'El producto aparece a escala imposible, integrado al entorno como si siempre hubiera estado ahí',
    'La física se dobla alrededor del producto: el entorno reacciona de forma surreal pero coherente',
  ],
};

// Resumen display de una semilla: español cuando la campaña está en español;
// en inglés no hace falta (la UI muestra el scenePrompt tal cual).
function seedSummary(slug: string, index: number, language: 'es' | 'en'): string | null {
  if (language !== 'es') return null;
  const summaries = CONCEPT_SUMMARIES_ES[slug] ?? GENERIC_SUMMARIES_ES;
  return summaries[index % summaries.length];
}

// `character` se elimina de la comprobación: el personaje puede inventarse en
// el prompt (DEFAULT_PRESENTER o inventados del matcher), por lo que su
// ausencia nunca bloquea un formato.
function formatFitsRefs(format: PlannerFormat, available: PlannerInput['available']): boolean {
  for (const ref of format.requiredRefs) {
    if (ref === 'product' && !available.product) return false;
    if (ref === 'packaging' && !available.packaging) return false;
  }
  return true;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Intercalar grupos (round-robin) para que el calendario no amontone items
// del mismo formato seguidos, y repartir fechas en el rango.
// Unidad de calendario: un grupo-secuencia (sequenceId != null) cuenta como
// UNA unidad (sus escenas comparten fecha y quedan contiguas); los grupos
// normales se intercalan item-a-item como antes.
function interleaveAndSchedule(
  groups: PlanItemDraft[][],
  dateStart: Date,
  dateEnd: Date,
): PlanItemDraft[] {
  const sequenceUnits = groups.filter((g) => g[0]?.sequenceId != null);
  const normalGroups = groups.filter((g) => g[0]?.sequenceId == null);

  const interleavedNormals: PlanItemDraft[] = [];
  const maxLen = Math.max(0, ...normalGroups.map((arr) => arr.length));
  for (let i = 0; i < maxLen; i++) {
    for (const arr of normalGroups) if (arr[i]) interleavedNormals.push(arr[i]);
  }

  const units: PlanItemDraft[][] = [
    ...interleavedNormals.map((it) => [it]),
    ...sequenceUnits,
  ];
  const rangeMs = Math.max(0, dateEnd.getTime() - dateStart.getTime());
  const step = units.length > 1 ? rangeMs / (units.length - 1) : 0;
  const out: PlanItemDraft[] = [];
  units.forEach((unit, idx) => {
    const date = isoDate(new Date(dateStart.getTime() + step * idx));
    for (const item of unit) {
      item.scheduledDate = date;
      out.push(item);
    }
  });
  return out;
}

// Techo demo (doc V2 §5.5): la arquitectura escala, el plan free no.
export const MAX_PLAN_ITEMS = 30;

// Tope de una ESCENA de secuencia: es un beat corto, no un clip suelto. Se
// clampa la duración resuelta (venga del matcher o del default del formato —
// un formato custom puede tener default 15s, pensado para clip único, no beat).
export const SEQUENCE_SCENE_MAX_S = 8;

// Plan dirigido por ideas: el usuario describió lo que quiere y el matcher
// lo mapeó a formatos (existentes o recién creados). Aquí NO se rellena hasta
// un volumen fijo — salen exactamente los creativos pedidos, uno por idea
// salvo que la idea pida cantidad. El scenePrompt del matcher (la acción
// concreta que escribió el usuario) manda; sin él, semillas del formato.
export type DirectedIdea = {
  format: PlannerFormat;
  count: number;
  scenePrompt: string | null;
  // Segundos que la acción necesita según el matcher (4-15); null = la
  // duración default del formato.
  durationS: number | null;
  // Resumen display del matcher en el idioma de la campaña (033); null cae a
  // la semilla en español (es) o al scenePrompt (en).
  sceneSummary: string | null;
  // Personajes mencionados explícitamente por el matcher, ya validados y
  // saneados. [0] = primer mencionado (principal). Array vacío = sin mención.
  characterIds: string[];
  // Personajes inventados por el matcher que no existen en el pool de la
  // campaña. Se inyectan como frases descriptivas en el scenePrompt.
  invented: Array<{ name: string; description: string }>;
  // Si la idea es un anuncio multi-escena, las escenas que el matcher propuso.
  // Vacio = idea normal (un solo clip).
  scenes: Array<{ scenePrompt: string; durationS: number | null; sceneSummary: string | null }>;
  sequenceLabel: string | null;
};

export type DirectedPlanInput = {
  ideas: DirectedIdea[];
  productName: string;
  goal: CaptionGoal;
  scenes: PlannerScene[];
  characters: PlannerCharacter[];
  available: PlannerInput['available'];
  dateStart: Date;
  dateEnd: Date;
  draftModelSlug: string;
  // Idioma de la campaña: decide el idioma del sceneSummary (033).
  language: 'es' | 'en';
  // Formato de video de la campaña (034): aplica a todos los items del plan.
  aspectRatio: string;
};

// PD-12: ajusta la duración de un clip a su diálogo. El matcher a veces deja la
// duración corta y la voz sale apresurada/robótica. Si el diálogo no cabe a ritmo
// natural (~2.5 palabras/seg ES, speech-fit), sube la duración a la sugerida, con
// tope maxS. No-op si no hay diálogo o ya cabe holgado.
function fitDialogueDuration(scenePrompt: string, baseDurationS: number, lang: 'es' | 'en', maxS: number): number {
  const dialogo = extractDialogue(scenePrompt);
  if (!dialogo) return baseDurationS;
  const { level, suggestedDurationS } = fitVerdict(estimateSpeechSeconds(dialogo, lang), baseDurationS);
  return level === 'tight' ? Math.min(suggestedDurationS, maxS) : baseDurationS;
}

export function buildDirectedPlan(input: DirectedPlanInput): PlanItemDraft[] {
  // Igual que el mix: nunca proponer un formato cuyas referencias faltan.
  const viable = input.ideas.filter((idea) => formatFitsRefs(idea.format, input.available));
  if (viable.length === 0) return [];

  let budget = MAX_PLAN_ITEMS;
  const groups: PlanItemDraft[][] = viable.map((idea, gIdx) => {
    // Rama secuencia: N escenas de un mismo anuncio, mismo sequenceId.
    if (idea.scenes.length > 0) {
      const allowed = Math.min(idea.scenes.length, budget);
      budget -= allowed;
      if (allowed === 0) return [];
      const sequenceId = crypto.randomUUID();
      const format = idea.format;
      // Las escenas de una secuencia son AUTO-CONTENIDAS (el matcher re-describe
      // escenario y personaje en cada scenePrompt). Imponerles un fragmento
      // genérico de scene_library (p. ej. "cocina") contradice la acción
      // (una pared, una sala) → se deja vacío y manda el scenePrompt.
      const fromIdea = idea.characterIds.filter((id) => input.characters.some((c) => c.id === id)).slice(0, 3);
      const inventedLines = idea.invented.map((p) => `${p.name} is ${p.description}.`);
      const needsCharacter = format.requiredRefs.includes('character');
      if (needsCharacter && fromIdea.length === 0 && inventedLines.length === 0) {
        inventedLines.push(`The presenter is ${DEFAULT_PRESENTER}.`);
      }
      return idea.scenes.slice(0, allowed).map((sc, sceneIndex) => {
        let scenePrompt = sc.scenePrompt;
        if (inventedLines.length) {
          scenePrompt = `${scenePrompt.trim().replace(/\.?$/, '.')} ${inventedLines.join(' ')}`;
        }
        return {
          formatId: format.id,
          formatSlug: format.slug,
          modelSlug: input.draftModelSlug,
          // Beat corto: clampa la duración resuelta (matcher o default del formato),
          // luego la sube si el diálogo no cabe (PD-12).
          durationS: fitDialogueDuration(
            scenePrompt,
            Math.min(sc.durationS ?? format.defaultDurationS, SEQUENCE_SCENE_MAX_S),
            input.language,
            SEQUENCE_SCENE_MAX_S,
          ),
          aspectRatio: input.aspectRatio,
          scene: '', // autocontenido en scenePrompt; sin fragmento impuesto
          audio: format.defaultAudio,
          characterIds: fromIdea,
          scenePrompt,
          sceneSummary: sc.sceneSummary,
          caption: buildCaption({ productName: input.productName, formatSlug: format.slug, goal: input.goal, index: sceneIndex }),
          scheduledDate: '',
          sequenceId,
          sceneIndex,
          sequenceLabel: idea.sequenceLabel,
        } satisfies PlanItemDraft;
      });
    }

    // Rama normal: idéntica a la actual.
    const count = Math.min(Math.max(1, idea.count), budget);
    budget -= count;
    const format = idea.format;
    const seeds = CONCEPT_SEEDS[format.slug] ?? GENERIC_SEEDS;
    const needsCharacter = format.requiredRefs.includes('character');
    const items: PlanItemDraft[] = [];
    for (let i = 0; i < count; i++) {
      const scene = input.scenes[(gIdx + i) % Math.max(1, input.scenes.length)] ?? {
        name: 'Estudio',
        fragment: 'a clean minimal studio setting with controlled soft light',
      };

      // Personajes mencionados por el matcher, validados contra el pool.
      const fromIdea = idea.characterIds
        .filter((id) => input.characters.some((c) => c.id === id))
        .slice(0, 3);
      // Rotación del pool cuando no hay mención explícita.
      const rotated =
        needsCharacter && input.characters.length
          ? [input.characters[(gIdx + i) % input.characters.length].id]
          : [];
      const characterIds = fromIdea.length ? fromIdea : rotated;

      const seed = seeds[i % seeds.length];
      const usedSeed = idea.scenePrompt === null;
      let scenePrompt = idea.scenePrompt ?? seed({ product: input.productName, scene: scene.fragment });
      // Display: el resumen del matcher manda; con semilla, su versión en español.
      const sceneSummary =
        idea.sceneSummary ?? (usedSeed ? seedSummary(format.slug, i, input.language) : null);

      // Personajes inventados → frases descriptivas en el scenePrompt.
      const inventedLines = idea.invented.map((p) => `${p.name} is ${p.description}.`);
      // Sin pool, sin inventados y el formato pide personaje → presentador genérico.
      if (needsCharacter && characterIds.length === 0 && inventedLines.length === 0) {
        inventedLines.push(`The presenter is ${DEFAULT_PRESENTER}.`);
      }
      if (inventedLines.length) {
        scenePrompt = `${scenePrompt.trim().replace(/\.?$/, '.')} ${inventedLines.join(' ')}`;
      }

      items.push({
        formatId: format.id,
        formatSlug: format.slug,
        modelSlug: input.draftModelSlug,
        // La duración la decide la escena (matcher); sin ella, el formato. Se sube
        // si el diálogo no cabe a ritmo natural (PD-12).
        durationS: fitDialogueDuration(
          scenePrompt,
          idea.durationS ?? format.defaultDurationS,
          input.language,
          DUR_MAX,
        ),
        // El formato de video lo decide la campaña (034), sin excepciones por
        // slug: la elección explícita del usuario manda.
        aspectRatio: input.aspectRatio,
        // El fragmento de scene_library SOLO se impone cuando la acción salió de
        // una semilla. Si el usuario describió su propia acción (con su entorno),
        // un fragmento genérico ("estudio minimal") contradice ese entorno y
        // Seedance recibe dos escenas en conflicto. Misma decisión que la rama
        // de secuencia (autocontenida).
        scene: usedSeed ? scene.fragment : '',
        audio: format.defaultAudio,
        characterIds,
        scenePrompt,
        sceneSummary,
        caption: buildCaption({
          productName: input.productName,
          formatSlug: format.slug,
          goal: input.goal,
          index: i,
        }),
        scheduledDate: '',
        sequenceId: null,
        sceneIndex: null,
        sequenceLabel: null,
      });
    }
    return items;
  });

  return interleaveAndSchedule(groups, input.dateStart, input.dateEnd);
}

export function buildPlan(input: PlannerInput): PlanItemDraft[] {
  const relevantSlugs = CATEGORY_MIX[input.category] ?? CATEGORY_MIX.other;
  // Candidatos: formatos del mix de la categoría + formatos custom del usuario
  // (slug sin semillas propias → usa las genéricas). El catálogo es del
  // usuario, no de la plataforma (doc V2 §3).
  const candidates = input.formats
    .filter((f) => relevantSlugs.includes(f.slug) || !CONCEPT_SEEDS[f.slug])
    .filter((f) => formatFitsRefs(f, input.available));

  if (candidates.length === 0 || input.totalItems < 1) return [];

  // Reparto proporcional al peso: formato con ganadores pesa doble (el
  // aprendizaje sesga el mix, no lo monopoliza). Sin ganadores, todos pesan 1
  // y el reparto queda parejo con resto a los primeros — igual que antes.
  const winning = new Set(input.winningSlugs ?? []);
  const weights = candidates.map((f) => (winning.has(f.slug) ? 2 : 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (input.totalItems * w) / totalWeight);
  const counts = raw.map(Math.floor);
  let rest = input.totalItems - counts.reduce((a, b) => a + b, 0);
  const byFraction = raw
    .map((r, idx) => ({ idx, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.idx - b.idx);
  for (const { idx } of byFraction) {
    if (rest <= 0) break;
    counts[idx] += 1;
    rest -= 1;
  }

  // Construcción por formato, variando escena y semilla para no repetir
  // escena+concepto dentro del mismo formato.
  const itemsByFormat: PlanItemDraft[][] = candidates.map((format, fIdx) => {
    const count = counts[fIdx];
    const seeds = CONCEPT_SEEDS[format.slug] ?? GENERIC_SEEDS;
    const needsCharacter = format.requiredRefs.includes('character');
    const items: PlanItemDraft[] = [];
    for (let i = 0; i < count; i++) {
      // Offset por formato para que dos formatos no usen la misma escena el mismo día.
      const scene = input.scenes[(fIdx + i) % Math.max(1, input.scenes.length)] ?? {
        name: 'Estudio',
        fragment: 'a clean minimal studio setting with controlled soft light',
      };
      const characterIds =
        needsCharacter && input.characters.length
          ? [input.characters[(fIdx + i) % input.characters.length].id]
          : [];

      const seed = seeds[i % seeds.length];
      let scenePrompt = seed({ product: input.productName, scene: scene.fragment });
      // Sin pool de personajes y el formato pide personaje → presentador genérico.
      if (needsCharacter && characterIds.length === 0) {
        scenePrompt = `${scenePrompt.trim().replace(/\.?$/, '.')} The presenter is ${DEFAULT_PRESENTER}.`;
      }

      items.push({
        formatId: format.id,
        formatSlug: format.slug,
        modelSlug: input.draftModelSlug,
        durationS: format.defaultDurationS,
        // El formato de video lo decide la campaña (034).
        aspectRatio: input.aspectRatio,
        scene: scene.fragment,
        audio: format.defaultAudio,
        characterIds,
        scenePrompt,
        sceneSummary: seedSummary(format.slug, i, input.language),
        caption: buildCaption({
          productName: input.productName,
          formatSlug: format.slug,
          goal: input.goal,
          index: i,
        }),
        scheduledDate: '', // se asigna abajo, intercalado
        sequenceId: null,
        sceneIndex: null,
        sequenceLabel: null,
      });
    }
    return items;
  });

  return interleaveAndSchedule(itemsByFormat, input.dateStart, input.dateEnd);
}
