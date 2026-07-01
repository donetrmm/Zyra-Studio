import 'server-only';
import { z } from 'zod';
import {
  type GenerationResult,
  NANO_BANANA_MAX_REFS,
  type NanoBananaParams,
  ProviderError,
} from './types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// Slug del modelo Nano por defecto (Gemini 3 Pro). Fuente única de verdad:
// tanto el server action del storyboard como el worker lo importan de aquí.
export const NANO_MODEL_SLUG = 'gemini-3-pro-image-preview';

// Resolución por defecto para los paneles Nano.
export const NANO_VARIANT = '2k';

export function nanoVariantToResolution(variant: string): '512' | '1K' | '2K' | '4K' {
  switch (variant) {
    case '1k':
      return '1K';
    case '2k':
      return '2K';
    case '4k':
      return '4K';
    default:
      return '2K';
  }
}

// Gemini REST puede devolver thoughtSignature (camelCase) o thought_signature.
const PartSchema = z.union([
  z.object({
    text: z.string(),
    thoughtSignature: z.string().optional(),
    thought_signature: z.string().optional(),
  }),
  z.object({
    inlineData: z.object({ mimeType: z.string(), data: z.string() }),
    thoughtSignature: z.string().optional(),
    thought_signature: z.string().optional(),
  }),
  z.object({
    inline_data: z.object({ mime_type: z.string(), data: z.string() }),
    thoughtSignature: z.string().optional(),
    thought_signature: z.string().optional(),
  }),
]);

// Gemini devuelve HTTP 200 sin `parts` (a veces sin `content`) cuando bloquea
// o no produce salida: el motivo viaja en `finishReason`/`promptFeedback`. Por
// eso content y parts son opcionales aquí; interpretResponse clasifica el caso
// sin imagen en un error accionable en vez de un fallo de schema.
const ResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(PartSchema).optional() }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .min(1),
  promptFeedback: z
    .object({
      blockReason: z.string().optional(),
      safetyRatings: z.array(z.unknown()).optional(),
    })
    .optional(),
});

// finishReasons de Gemini que significan "bloqueado por políticas".
const SAFETY_FINISH_REASONS = new Set([
  'SAFETY',
  'IMAGE_SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'RECITATION',
]);

const ErrorSchema = z.object({
  error: z.object({
    code: z.number(),
    message: z.string(),
    status: z.string().optional(),
  }),
});

const TEXT_IN_IMAGE_DIRECTIVE =
  'Render any embedded text exactly as written, preserve spelling, kerning and legible typography; align text crisply within the composition.';

const NO_BG_DIRECTIVE =
  'Generate the subject isolated on a plain solid pure white background (#FFFFFF). No shadows, no ground plane, no gradients, no environment. The background must be completely uniform white.';

function buildPrompt(params: NanoBananaParams): string {
  let prompt = params.prompt.trim();
  if (params.hasTextInImage) {
    prompt = `${TEXT_IN_IMAGE_DIRECTIVE} ${prompt}`;
  }
  if (params.noBackground) {
    prompt = `${NO_BG_DIRECTIVE} ${prompt}`;
  }
  return prompt;
}

type Part =
  | { text: string; thoughtSignature?: string }
  | {
      inline_data: { mime_type: string; data: string };
      thoughtSignature?: string;
    };

// Exportada para test determinista (no llama a red): verifica el armado de contents,
// el descarte de refs en chat y la inclusión de chatReferences.
export function buildBody(params: NanoBananaParams) {
  const maxRefs = NANO_BANANA_MAX_REFS[params.model];

  // Chat multi-turn solo es válido si tenemos la firma del razonamiento del
  // turn anterior. Sin ella, Gemini 3 rechaza el request:
  //   "Image part is missing a thought_signature in content position 2…"
  // Cuando falta (parent viejo, response sin sig, etc.), degradamos a single-turn
  // con la imagen previa adjunta como ref normal del user turn actual. Pierde
  // coherencia narrativa pero evita el 400 y mantiene la iteración funcional.
  const wantsChat = !!params.previousTurn?.thoughtSignature;

  // En chat real las refs externas se ignoran (Gemini las trataría como
  // "edita esta ref con el nuevo prompt" y descartaría la imagen del turn
  // anterior). En el fallback sí van — la previa cuenta como una ref más.
  const refSlots = wantsChat
    ? 0
    : params.previousTurn
      ? Math.max(0, maxRefs - 1)
      : maxRefs;
  const refs = (params.references ?? []).slice(0, refSlots);

  const promptText =
    params.previousTurn && !wantsChat
      ? `Edit the previous image (attached) based on: ${buildPrompt(params)}`
      : buildPrompt(params);

  const newUserParts: Part[] = [{ text: promptText }];
  for (const ref of refs) {
    newUserParts.push({
      inline_data: {
        mime_type: ref.mimeType,
        data: ref.buffer.toString('base64'),
      },
    });
  }
  // EXPERIMENTAL (smoke): en chat real (refs normales descartadas) se permite
  // re-anclar referencias elegidas (el producto) en el turno actual. Fuera de chat
  // no aplica: ahí ya van por `references`.
  if (wantsChat) {
    for (const ref of params.chatReferences ?? []) {
      newUserParts.push({
        inline_data: {
          mime_type: ref.mimeType,
          data: ref.buffer.toString('base64'),
        },
      });
    }
  }
  if (params.previousTurn && !wantsChat) {
    newUserParts.push({
      inline_data: {
        mime_type: params.previousTurn.mimeType,
        data: params.previousTurn.imageBuffer.toString('base64'),
      },
    });
  }

  const contents: Array<{
    role?: 'user' | 'model';
    parts: Part[];
  }> = [];
  if (wantsChat && params.previousTurn) {
    contents.push({
      role: 'user',
      parts: [{ text: params.previousTurn.prompt }],
    });
    const modelPart: Part = {
      inline_data: {
        mime_type: params.previousTurn.mimeType,
        data: params.previousTurn.imageBuffer.toString('base64'),
      },
      thoughtSignature: params.previousTurn.thoughtSignature,
    };
    contents.push({ role: 'model', parts: [modelPart] });
    contents.push({ role: 'user', parts: newUserParts });
  } else {
    contents.push({ parts: newUserParts });
  }

  type GenConfig = {
    responseModalities: string[];
    imageConfig?: { aspectRatio?: string; imageSize?: string };
  };
  const generationConfig: GenConfig = { responseModalities: ['IMAGE'] };
  if (params.aspectRatio || params.resolution) {
    generationConfig.imageConfig = {};
    if (params.aspectRatio) generationConfig.imageConfig.aspectRatio = params.aspectRatio;
    if (params.resolution) generationConfig.imageConfig.imageSize = params.resolution;
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig,
  };

  if (params.useGrounding) {
    body.tools = [{ google_search: {} }];
  }

  return body;
}

function decodeImagePart(parts: Array<unknown>): GenerationResult | null {
  // Gemini 3 puede devolver el thoughtSignature en el image part o en un
  // text/thought part adyacente (los docs dicen "MAY contain", final part).
  // Recorremos todo y nos quedamos con el primer sig en image part; si no
  // hay, usamos cualquier sig presente como fallback. Si el replay de ese sig
  // falla en request (404 NOT_FOUND), generate() reintenta en single-turn
  // (ver isChatSignatureRejection); si el sig falta de entrada, el fallback
  // single-turn lo decide buildBody.
  let image: { buffer: Buffer; mimeType: string; sig?: string } | null = null;
  let fallbackSig: string | undefined;
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue;
    const sig =
      (part as { thoughtSignature?: string }).thoughtSignature ??
      (part as { thought_signature?: string }).thought_signature;
    if ('inlineData' in part) {
      const p = part as { inlineData: { mimeType: string; data: string } };
      if (!image) {
        image = {
          buffer: Buffer.from(p.inlineData.data, 'base64'),
          mimeType: p.inlineData.mimeType,
          sig,
        };
      }
    } else if ('inline_data' in part) {
      const p = part as { inline_data: { mime_type: string; data: string } };
      if (!image) {
        image = {
          buffer: Buffer.from(p.inline_data.data, 'base64'),
          mimeType: p.inline_data.mime_type,
          sig,
        };
      }
    } else if (sig && !fallbackSig) {
      fallbackSig = sig;
    }
  }
  if (!image) return null;
  return {
    buffer: image.buffer,
    mimeType: image.mimeType,
    thoughtSignature: image.sig ?? fallbackSig,
  };
}

// Interpreta la respuesta JSON de Gemini. Exportada para test determinista (no
// llama a red). Devuelve la imagen decodificada, o lanza un ProviderError con
// motivo accionable cuando Gemini bloquea o responde 200 sin imagen.
export function interpretResponse(json: unknown): GenerationResult {
  const parsed = ResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderError(
      `Respuesta inesperada de Gemini: ${parsed.error.message}`,
      'unknown',
      false,
    );
  }

  const data = parsed.data;
  if (data.promptFeedback?.blockReason) {
    throw new ProviderError(
      `El proveedor rechazó el contenido por políticas de seguridad (${data.promptFeedback.blockReason}).`,
      'safety',
      false,
    );
  }

  const candidate = data.candidates[0];
  const result = decodeImagePart(candidate.content?.parts ?? []);
  if (result) return result;

  // HTTP 200 sin imagen: el motivo viaja en finishReason. Lo surfaceamos en vez
  // de fallar el schema con un error críptico.
  const reason = candidate.finishReason ?? 'UNKNOWN';
  if (SAFETY_FINISH_REASONS.has(reason)) {
    throw new ProviderError(
      `El proveedor rechazó el contenido por políticas de seguridad (${reason}).`,
      'safety',
      false,
    );
  }
  if (reason === 'MAX_TOKENS') {
    throw new ProviderError(
      'Gemini agotó el presupuesto de tokens antes de emitir la imagen. Reintenta o simplifica el prompt.',
      'server',
      true,
    );
  }
  throw new ProviderError(
    `La respuesta no incluyó imagen (finishReason: ${reason}). Reintenta o ajusta el prompt.`,
    'unknown',
    false,
  );
}

// ¿El fallo es Gemini rechazando el thought_signature replayado del turno previo?
// Devuelve 404 NOT_FOUND ("Requested entity was not found") cuando el sig ya no es
// válido: expiró, o la 'exact part' rule del replay no calza (el turno previo se
// reconstruye como solo-texto, sin las imágenes que lo originaron). En ese caso el
// adapter reintenta en single-turn (editando la imagen previa como referencia normal).
export function isChatSignatureRejection(status: number, errorStatus?: string): boolean {
  return status === 404 || errorStatus === 'NOT_FOUND';
}

async function callOnce(
  params: NanoBananaParams,
  apiKey: string,
): Promise<Response> {
  const url = `${ENDPOINT}/${params.model}:generateContent`;
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(buildBody(params)),
  });
}

export async function generate(
  params: NanoBananaParams,
  _opts?: { noChatFallback?: boolean },
): Promise<GenerationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);
  }

  let res = await callOnce(params, apiKey);

  const RETRY_DELAYS = [2000, 5000, 10000];
  for (const delay of RETRY_DELAYS) {
    if (res.status !== 429) break;
    await res.body?.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, delay));
    res = await callOnce(params, apiKey);
  }
  if (res.status === 429) {
    throw new ProviderError(
      'Rate limit del proveedor. Intenta de nuevo en unos segundos.',
      'rate_limit',
      true,
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('Auth inválida con Gemini API', 'auth', false);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    let errorStatus: string | undefined;
    try {
      const errJson = await res.json();
      const parsedErr = ErrorSchema.safeParse(errJson);
      if (parsedErr.success) {
        detail = parsedErr.data.error.message;
        errorStatus = parsedErr.data.error.status;
        if (
          parsedErr.data.error.status === 'INVALID_ARGUMENT' ||
          parsedErr.data.error.code === 400
        ) {
          throw new ProviderError(detail, 'invalid_input', false);
        }
      }
    } catch (e) {
      if (e instanceof ProviderError) throw e;
    }

    // Fallback de chat conversacional: si Gemini rechaza el thought_signature del
    // turno previo (404 NOT_FOUND), reintentamos UNA vez en single-turn — al quitar
    // el sig, buildBody edita la imagen previa como referencia normal (sin chat). Es
    // el fallback que el adapter siempre pretendió tener para la 'exact part' rule,
    // ahora también para el rechazo en request. Cubre refinePanelAction y la
    // generación encadenada (ambas replayean el sig del panel anterior).
    if (
      !_opts?.noChatFallback &&
      params.previousTurn?.thoughtSignature &&
      isChatSignatureRejection(res.status, errorStatus)
    ) {
      return generate(
        { ...params, previousTurn: { ...params.previousTurn, thoughtSignature: undefined } },
        { noChatFallback: true },
      );
    }

    if (res.status >= 500) {
      throw new ProviderError(detail, 'server', true);
    }
    throw new ProviderError(detail, 'unknown', false);
  }

  const json = await res.json();
  const result = interpretResponse(json);

  if (params.noBackground) {
    const sharp = (await import('sharp')).default;
    const { data, info } = await sharp(result.buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const threshold = 250;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > threshold && data[i + 1] > threshold && data[i + 2] > threshold) {
        data[i + 3] = 0;
      }
    }
    result.buffer = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    }).png().toBuffer();
    result.mimeType = 'image/png';
  }

  return result;
}
