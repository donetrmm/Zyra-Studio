import 'server-only';
import { z } from 'zod';
import {
  type GenerationResult,
  NANO_BANANA_MAX_REFS,
  type NanoBananaParams,
  ProviderError,
} from './types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

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

const ResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(PartSchema) }),
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
  'Generate the subject on a completely transparent background with no ground, shadow or environment. Output as PNG with alpha transparency.';

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

function buildBody(params: NanoBananaParams) {
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
  // hay, usamos cualquier sig presente como fallback. Si replay falla por
  // "exact part" rule, el adapter cae al modo single-turn (ver buildBody).
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

export async function generate(params: NanoBananaParams): Promise<GenerationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);
  }

  let res = await callOnce(params, apiKey);

  const RETRY_DELAYS = [2000, 5000, 10000];
  for (const delay of RETRY_DELAYS) {
    if (res.status !== 429) break;
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
    try {
      const errJson = await res.json();
      const parsedErr = ErrorSchema.safeParse(errJson);
      if (parsedErr.success) {
        detail = parsedErr.data.error.message;
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
    if (res.status >= 500) {
      throw new ProviderError(detail, 'server', true);
    }
    throw new ProviderError(detail, 'unknown', false);
  }

  const json = await res.json();
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
  if (candidate.finishReason && candidate.finishReason === 'SAFETY') {
    throw new ProviderError(
      'El proveedor rechazó el contenido por políticas de seguridad.',
      'safety',
      false,
    );
  }

  const result = decodeImagePart(candidate.content.parts);
  if (!result) {
    throw new ProviderError(
      'La respuesta no incluyó imagen. Reintenta o ajusta el prompt.',
      'unknown',
      false,
    );
  }

  if (params.noBackground && result.mimeType !== 'image/png') {
    const sharp = (await import('sharp')).default;
    result.buffer = await sharp(result.buffer).png().toBuffer();
    result.mimeType = 'image/png';
  }

  return result;
}
