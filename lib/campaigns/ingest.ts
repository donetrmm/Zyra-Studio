import 'server-only';
import { IngestRawSchema, MASTER_PROMPT_MAX, type IngestBriefOverrides, type IngestResult } from '@/lib/schemas/ingest';
import type { ProductBrief } from './brief';
import { gatewayText } from '@/lib/providers/gateway';
import { normalizeText } from './text-normalize';

const MODEL = 'gemini-2.5-flash';
const VISUAL_DETAILS_MAX = 800;

export const INGEST_SYSTEM = `Eres un asistente que convierte un PROMPT MAESTRO de un comercial (escrito como para un solo render tipo Veo/Sora) en los elementos estructurados de una plataforma composicional. NO reescribes el mundo: REPARTES lo que ya está escrito.

Devuelve SOLO un JSON con esta forma exacta:
{
  "productFacts": {"heightCm": number|null, "widthCm": number|null, "weightKg": number|null, "thicknessMm": number|null, "medium": "string|null"},
  "productVisualDetails": "string|null",
  "visualStyle": "ultra_realista|casero|fantasia|animado|null",
  "guidelines": {"safeCrop": "4:5"|null, "showFullProduct": boolean, "hookProductHero": boolean},
  "castMentions": ["nombres propios de personas que actúan o hablan"],
  "locationHints": ["locaciones/escenarios distintos descritos"],
  "narrative": "el guion por clip, LIMPIO, en UNA SOLA CADENA de texto",
  "warnings": ["avisos legibles para el usuario"]
}

Reglas:
- productFacts: SOLO medidas/peso/material que el prompt DIGA explícitamente. NO inventes. null si no aparece.
- productVisualDetails: la descripción visual fina del producto (material, acabado, proporción, contenido impreso), en INGLÉS, densa, 2-3 frases máximo. Es lo que el usuario escribió; no inventes atributos.
- visualStyle: 'casero' si la estética es UGC / grabado con celular / handheld / nativo del feed; 'ultra_realista' si pide realismo fotográfico de producción; 'animado' o 'fantasia' si aplica claramente; null si no hay señal clara.
- guidelines: safeCrop='4:5' si menciona área/zona segura 4:5 o encuadre 9:16 con el contenido clave al centro; showFullProduct si insiste en mostrar el producto completo; hookProductHero si el primer beat es el producto como héroe.
- castMentions: nombres propios de personas que actúan o hablan (no figurantes de fondo, no personajes inventados que no actúan).
- locationHints: locaciones/escenarios distintos descritos.
- narrative: el guion CLIP POR CLIP, en el MISMO idioma del prompt, UNA escena por clip, conservando acciones, diálogo y orden. Es UNA SOLA CADENA de texto (NUNCA un array ni un objeto), con los clips separados por saltos de línea. QUITA de aquí las medidas/material del producto y la estética global (YA van en sus campos) para no duplicar ni contradecir. NO escribas texto en pantalla ni emojis.
- warnings: cuenta los clips y avisa si son muchos (>12); avisa si nombra personas que quizá no estén en el Cast; avisa si las transiciones requieren montaje posterior.

Cast disponible del workspace (para resolver menciones; NO lo repitas en la salida): __CAST__.
Devuelve SOLO el JSON válido, sin markdown.`;

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function norm(s: string): string {
  return normalizeText(s);
}

// La descripción del usuario MANDA (va primero); se concatena la detectada sin
// duplicar, capado a 800 (límite del schema del brief).
export function mergeVisualDetails(detected: string, fromPrompt: string): string {
  const d = detected.trim();
  const p = fromPrompt.trim();
  if (!d) return p.slice(0, VISUAL_DETAILS_MAX);
  if (!p) return d.slice(0, VISUAL_DETAILS_MAX);
  if (d.includes(p) || p.includes(d)) {
    return (p.length >= d.length ? p : d).slice(0, VISUAL_DETAILS_MAX);
  }
  return `${p} ${d}`.slice(0, VISUAL_DETAILS_MAX);
}

export function mergeBriefOverrides(
  brief: ProductBrief,
  overrides: IngestBriefOverrides | undefined,
): ProductBrief {
  if (!overrides) return brief;
  const f = overrides.productFacts;
  return {
    ...brief,
    ...(f?.heightCm != null ? { heightCm: f.heightCm } : {}),
    ...(f?.widthCm != null ? { widthCm: f.widthCm } : {}),
    ...(f?.weightKg != null ? { weightKg: f.weightKg } : {}),
    ...(f?.thicknessMm != null ? { thicknessMm: f.thicknessMm } : {}),
    ...(f?.medium ? { medium: f.medium } : {}),
    ...(overrides.productVisualDetails
      ? { visualDetails: mergeVisualDetails(brief.visualDetails, overrides.productVisualDetails) }
      : {}),
  };
}

// Salida cruda de Gemini → IngestResult (computa castHints). JSON inválido → fallback.
export function parseIngestResult(
  raw: string,
  opts: { castNames: string[]; masterPrompt?: string },
): IngestResult {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(raw));
  } catch {
    return fallbackIngestResult(opts.masterPrompt ?? '');
  }
  const parsed = IngestRawSchema.safeParse(json);
  if (!parsed.success) return fallbackIngestResult(opts.masterPrompt ?? '');
  const d = parsed.data;
  const known = new Set(opts.castNames.map(norm));
  const productFacts: IngestResult['productFacts'] = {
    ...(d.productFacts.heightCm != null ? { heightCm: d.productFacts.heightCm } : {}),
    ...(d.productFacts.widthCm != null ? { widthCm: d.productFacts.widthCm } : {}),
    ...(d.productFacts.weightKg != null ? { weightKg: d.productFacts.weightKg } : {}),
    ...(d.productFacts.thicknessMm != null ? { thicknessMm: d.productFacts.thicknessMm } : {}),
    ...(d.productFacts.medium ? { medium: d.productFacts.medium } : {}),
  };
  // Aviso de escala (falla silenciosa Anuncio #12 V2): un producto físico
  // (medium seteado, p. ej. canvas/taza/playera) sin medidas deja a
  // describeProductScale sin ancla — el storyboard lo renderiza a un tamaño
  // arbitrario (suele salir muy chico) sin señal alguna. Basta una dimensión
  // (heightCm ?? widthCm), igual que el ancla de escala.
  const pf = d.productFacts;
  const missingDims = !!pf.medium && pf.heightCm == null && pf.widthCm == null;
  const warnings = [
    ...d.warnings,
    // Garantía: el campo de ideas NUNCA queda vacío en silencio. Si el modelo no
    // devolvió guion (o vino con forma no-string y la coerción lo dejó vacío),
    // cae al prompt crudo con aviso — el reparto (ficha/estilo/guías) se conserva.
    ...(d.narrative
      ? []
      : ['No pude extraer el guion por clips; puse tu prompt tal cual — revísalo y edítalo.']),
    ...(missingDims
      ? [
          `Tu producto es un objeto físico (${pf.medium}) pero no indica medidas: el storyboard no podrá fijar su escala y puede salir de tamaño equivocado. Añade alto y ancho (cm) en la ficha.`,
        ]
      : []),
  ];
  return {
    productFacts,
    productVisualDetails: d.productVisualDetails,
    visualStyle: d.visualStyle,
    guidelines: d.guidelines,
    castHints: [...new Set(d.castMentions)].map((name) => {
      const inCast = known.has(norm(name));
      return {
        name,
        inCast,
        note: inCast ? '' : 'No está en tu Cast: su identidad cambiará entre clips.',
      };
    }),
    locationHints: [...new Set(d.locationHints)],
    narrative: d.narrative || (opts.masterPrompt ?? '').trim(),
    warnings,
  };
}

export function fallbackIngestResult(masterPrompt: string): IngestResult {
  return {
    productFacts: {},
    productVisualDetails: null,
    visualStyle: null,
    guidelines: { safeCrop: null, showFullProduct: false, hookProductHero: false },
    castHints: [],
    locationHints: [],
    narrative: masterPrompt.trim(),
    warnings: ['No pude analizar el prompt automáticamente; revisa y edita los campos a mano.'],
  };
}

export async function ingestMasterPrompt(input: {
  masterPrompt: string;
  castNames: string[];
}): Promise<IngestResult> {
  const system = INGEST_SYSTEM.replace(
    '__CAST__',
    input.castNames.length ? input.castNames.join(', ') : '(ninguno)',
  );

  const { text: raw } = await gatewayText({
    model: MODEL,
    label: 'ingest',
    system,
    contents: [
      { role: 'user', parts: [{ text: input.masterPrompt.slice(0, MASTER_PROMPT_MAX) }] },
    ],
    temperature: 0.2,
    // El narrative devuelve el guion casi íntegro: con prompts cerca del cap
    // (60k chars ≈ 17k tokens) 8192 truncaba el JSON y todo caía al fallback.
    maxOutputTokens: 32768,
    json: true,
  });
  return parseIngestResult(raw, { castNames: input.castNames, masterPrompt: input.masterPrompt });
}
