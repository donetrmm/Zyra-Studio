// lib/prompt-director/format-matcher.ts
// Format matcher (specs/v2/07): texto libre del usuario → formato existente
// o propuesta de formato custom. Lo consumen el wizard (sembrar el plan) y
// el refinado (cuando la conversación se sale del catálogo).
// Patrón Gemini: fetch directo + responseMimeType JSON (como lib/campaigns/brief.ts).

import 'server-only';
import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';
import { CustomFormatSchema, type CustomFormat } from './custom-format-schema';
export { CustomFormatSchema, type CustomFormat };

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

export type MatcherFormat = { id: string; slug: string; name: string; description: string | null };

const MatchSchema = z.object({
  // Eco de la idea, solo informativo: el plan usa formato/count/scenePrompt.
  ideaText: z.string().min(1).max(2000),
  formatId: z.string().nullable(),
  customFormat: CustomFormatSchema.nullable(),
  // Cuántos creativos pide la idea ("3 versiones de..."). Sin cantidad
  // explícita el matcher devuelve 1; el techo total del plan lo pone el planner.
  count: z.number().int().min(1).max(10).catch(1).default(1),
  // Concepto concreto de la idea en inglés: va directo al scenePrompt del
  // item para que el creativo refleje lo que el usuario escribió.
  scenePrompt: z.string().trim().min(1).max(600).nullable().catch(null).default(null),
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

const SYSTEM = `Eres director creativo de una plataforma de anuncios con IA.
Recibes ideas de campaña en lenguaje natural y un catálogo de formatos.
Por cada idea distinta devuelve un match:
- Si encaja en un formato del catálogo: formatId con su id exacto y customFormat null.
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
- scenePrompt: la acción concreta de la idea, en INGLÉS, 1-2 frases, con el
  producto como ancla. Si la idea solo nombra un formato sin acción concreta
  ("quiero unboxings"), scenePrompt = null.
Nunca inventes atributos del producto. Devuelve SOLO el JSON:
{"matches":[{"ideaText":"...","formatId":"...|null","customFormat":{...}|null,"count":1,"scenePrompt":"...|null"}]}`;

export async function matchIdeas(input: {
  ideasText: string;
  formats: MatcherFormat[];
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
}): Promise<MatcherResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);

  const catalog = input.formats
    .map((f) => `- id=${f.id} slug=${f.slug} "${f.name}": ${f.description ?? ''}`)
    .join('\n');

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{
        role: 'user',
        parts: [{ text: `Catálogo:\n${catalog}\n\nIdeas del usuario:\n${input.ideasText.slice(0, 2000)}` }],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2000,
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

  // Saneo: formatId debe existir en el catálogo recibido; si no, null.
  const known = new Set(input.formats.map((f) => f.id));
  return {
    matches: matches.map((m) => ({
      ...m,
      formatId: m.formatId && known.has(m.formatId) ? m.formatId : null,
    })),
  };
}
