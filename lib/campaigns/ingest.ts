// lib/campaigns/ingest.ts
import 'server-only';
import { IngestRawSchema, type IngestBriefOverrides, type IngestResult } from '@/lib/schemas/ingest';
import type { ProductBrief } from './brief';
import { ProviderError } from '@/lib/providers/types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
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
  "narrative": "el guion por clip, LIMPIO",
  "warnings": ["avisos legibles para el usuario"]
}

Reglas:
- productFacts: SOLO medidas/peso/material que el prompt DIGA explícitamente. NO inventes. null si no aparece.
- productVisualDetails: la descripción visual fina del producto (material, acabado, proporción, contenido impreso), en INGLÉS, densa, 2-3 frases máximo. Es lo que el usuario escribió; no inventes atributos.
- visualStyle: 'casero' si la estética es UGC / grabado con celular / handheld / nativo del feed; 'ultra_realista' si pide realismo fotográfico de producción; 'animado' o 'fantasia' si aplica claramente; null si no hay señal clara.
- guidelines: safeCrop='4:5' si menciona área/zona segura 4:5 o encuadre 9:16 con el contenido clave al centro; showFullProduct si insiste en mostrar el producto completo; hookProductHero si el primer beat es el producto como héroe.
- castMentions: nombres propios de personas que actúan o hablan (no figurantes de fondo, no personajes inventados que no actúan).
- locationHints: locaciones/escenarios distintos descritos.
- narrative: el guion CLIP POR CLIP, en el MISMO idioma del prompt, UNA escena por clip, conservando acciones, diálogo y orden. QUITA de aquí las medidas/material del producto y la estética global (YA van en sus campos) para no duplicar ni contradecir. NO escribas texto en pantalla ni emojis.
- warnings: cuenta los clips y avisa si son muchos (>12); avisa si nombra personas que quizá no estén en el Cast; avisa si las transiciones requieren montaje posterior.

Cast disponible del workspace (para resolver menciones; NO lo repitas en la salida): __CAST__.
Devuelve SOLO el JSON válido, sin markdown.`;

const GeminiResponseSchema = {
  parse(json: unknown): string {
    const j = json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const parts = j.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p) => p.text ?? '').join('');
  },
};

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
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
export function parseIngestResult(raw: string, opts: { castNames: string[] }): IngestResult {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(raw));
  } catch {
    return fallbackIngestResult('');
  }
  const parsed = IngestRawSchema.safeParse(json);
  if (!parsed.success) return fallbackIngestResult('');
  const d = parsed.data;
  const known = new Set(opts.castNames.map(norm));
  const productFacts: IngestResult['productFacts'] = {
    ...(d.productFacts.heightCm != null ? { heightCm: d.productFacts.heightCm } : {}),
    ...(d.productFacts.widthCm != null ? { widthCm: d.productFacts.widthCm } : {}),
    ...(d.productFacts.weightKg != null ? { weightKg: d.productFacts.weightKg } : {}),
    ...(d.productFacts.thicknessMm != null ? { thicknessMm: d.productFacts.thicknessMm } : {}),
    ...(d.productFacts.medium ? { medium: d.productFacts.medium } : {}),
  };
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
    narrative: d.narrative,
    warnings: d.warnings,
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);

  const system = INGEST_SYSTEM.replace(
    '__CAST__',
    input.castNames.length ? input.castNames.join(', ') : '(ninguno)',
  );

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: input.masterPrompt.slice(0, 24000) }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,
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
    throw new ProviderError(`Gemini ingest ${res.status}: ${text.slice(0, 200)}`, 'server', res.status >= 500);
  }
  const raw = GeminiResponseSchema.parse(await res.json());
  return parseIngestResult(raw, { castNames: input.castNames });
}
