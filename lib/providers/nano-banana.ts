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

function buildPrompt(params: NanoBananaParams): string {
  let prompt = params.prompt;
  if (params.hasTextInImage) {
    prompt = prompt.trim();
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
  const refs = (params.references ?? []).slice(0, maxRefs);

  // Construir las partes del último turno (prompt nuevo + refs externas)
  const newUserParts: Part[] = [{ text: buildPrompt(params) }];
  for (const ref of refs) {
    newUserParts.push({
      inline_data: {
        mime_type: ref.mimeType,
        data: ref.buffer.toString('base64'),
      },
    });
  }

  // Multi-turn cuando hay `previousTurn`: la imagen previa va con role:'model'
  // para que Gemini la trate como SU output anterior (edición in-place).
  // Sin esto, agregarla como inline_data en el mismo turn la hace una ref de
  // inspiración y el modelo "pega" la cara sin integrarla.
  // Gemini 3 requiere que las partes que vinieron del modelo se reenvíen con
  // su thoughtSignature original; si falta, devuelve 400.
  const contents: Array<{
    role?: 'user' | 'model';
    parts: Part[];
  }> = [];
  if (params.previousTurn) {
    contents.push({
      role: 'user',
      parts: [{ text: params.previousTurn.prompt }],
    });
    const modelPart: Part = {
      inline_data: {
        mime_type: params.previousTurn.mimeType,
        data: params.previousTurn.imageBuffer.toString('base64'),
      },
    };
    if (params.previousTurn.thoughtSignature) {
      modelPart.thoughtSignature = params.previousTurn.thoughtSignature;
    }
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
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue;
    const sig =
      (part as { thoughtSignature?: string }).thoughtSignature ??
      (part as { thought_signature?: string }).thought_signature;
    if ('inlineData' in part) {
      const p = part as { inlineData: { mimeType: string; data: string } };
      return {
        buffer: Buffer.from(p.inlineData.data, 'base64'),
        mimeType: p.inlineData.mimeType,
        thoughtSignature: sig,
      };
    }
    if ('inline_data' in part) {
      const p = part as { inline_data: { mime_type: string; data: string } };
      return {
        buffer: Buffer.from(p.inline_data.data, 'base64'),
        mimeType: p.inline_data.mime_type,
        thoughtSignature: sig,
      };
    }
  }
  return null;
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

  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await callOnce(params, apiKey);
    if (res.status === 429) {
      throw new ProviderError(
        'Rate limit del proveedor. Intenta de nuevo en unos segundos.',
        'rate_limit',
        true,
      );
    }
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

  return result;
}
