import 'server-only';
import { APICallError, generateText, type ModelMessage } from 'ai';
import {
  type GenerationResult,
  NANO_BANANA_MAX_REFS,
  type NanoBananaParams,
  ProviderError,
} from './types';
import { toGatewayModel } from './gateway';

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

type NanoRequest = {
  messages: ModelMessage[];
  providerOptions: { google: Record<string, unknown> };
};

type NanoFilePart = {
  type: 'file';
  mediaType: string;
  data: Buffer;
  providerOptions?: { google: { thoughtSignature: string } };
};
type NanoTextPart = { type: 'text'; text: string };
type NanoPart = NanoFilePart | NanoTextPart;

// Exportada para test determinista (no llama a red): verifica el armado de
// messages, el descarte de refs en chat y la inclusión de chatReferences.
export function buildRequest(params: NanoBananaParams): NanoRequest {
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

  const newUserParts: NanoPart[] = [{ type: 'text', text: promptText }];
  for (const ref of refs) {
    newUserParts.push({ type: 'file', mediaType: ref.mimeType, data: ref.buffer });
  }
  // EXPERIMENTAL (smoke): en chat real (refs normales descartadas) se permite
  // re-anclar referencias elegidas (el producto) en el turno actual. Fuera de chat
  // no aplica: ahí ya van por `references`.
  if (wantsChat) {
    for (const ref of params.chatReferences ?? []) {
      newUserParts.push({ type: 'file', mediaType: ref.mimeType, data: ref.buffer });
    }
  }
  if (params.previousTurn && !wantsChat) {
    newUserParts.push({
      type: 'file',
      mediaType: params.previousTurn.mimeType,
      data: params.previousTurn.imageBuffer,
    });
  }

  const messages: ModelMessage[] = [];
  if (wantsChat && params.previousTurn) {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: params.previousTurn.prompt }],
    });
    messages.push({
      role: 'assistant',
      content: [
        {
          type: 'file',
          mediaType: params.previousTurn.mimeType,
          data: params.previousTurn.imageBuffer,
          providerOptions: {
            google: { thoughtSignature: params.previousTurn.thoughtSignature as string },
          },
        },
      ],
    } as ModelMessage);
    messages.push({ role: 'user', content: newUserParts } as ModelMessage);
  } else {
    messages.push({ role: 'user', content: newUserParts } as ModelMessage);
  }

  const imageConfig: { aspectRatio?: string; imageSize?: string } = {};
  if (params.aspectRatio) imageConfig.aspectRatio = params.aspectRatio;
  if (params.resolution) imageConfig.imageSize = params.resolution;

  return {
    messages,
    providerOptions: {
      google: {
        responseModalities: ['IMAGE'],
        ...(params.aspectRatio || params.resolution ? { imageConfig } : {}),
        ...(params.useGrounding ? { tools: [{ google_search: {} }] } : {}),
      },
    },
  };
}

// Interpreta el resultado normalizado del AI SDK. Exportada para test
// determinista (no llama a red). Devuelve la imagen decodificada, o lanza un
// ProviderError con motivo accionable cuando el modelo no produce imagen.
export function interpretResult(result: {
  files: Array<{ uint8Array: Uint8Array; mediaType: string }>;
  finishReason: string;
  providerMetadata?: Record<string, Record<string, unknown>>;
}): GenerationResult {
  const image = result.files.find((f) => f.mediaType.startsWith('image/'));
  if (image) {
    const sig = result.providerMetadata?.google?.thoughtSignature;
    return {
      buffer: Buffer.from(image.uint8Array),
      mimeType: image.mediaType,
      thoughtSignature: typeof sig === 'string' ? sig : undefined,
    };
  }
  if (result.finishReason === 'content-filter') {
    throw new ProviderError(
      'El proveedor rechazó el contenido por políticas de seguridad (content-filter).',
      'safety',
      false,
    );
  }
  if (result.finishReason === 'length') {
    throw new ProviderError(
      'Gemini agotó el presupuesto de tokens antes de emitir la imagen. Reintenta o simplifica el prompt.',
      'server',
      true,
    );
  }
  throw new ProviderError(
    `La respuesta no incluyó imagen (finishReason: ${result.finishReason}). Reintenta o ajusta el prompt.`,
    'unknown',
    false,
  );
}

// ¿El fallo es Gemini rechazando el thought_signature replayado del turno previo?
// Vía gateway el 404 NOT_FOUND del provider llega como APICallError con
// statusCode 404 (o el texto NOT_FOUND en el mensaje). Cubre lo mismo que antes:
// firma expirada, o la 'exact part' rule del replay que no calza. En ese caso el
// adapter reintenta en single-turn (editando la imagen previa como referencia normal).
export function isChatSignatureRejection(status: number | undefined, message: string): boolean {
  return status === 404 || message.includes('NOT_FOUND');
}

async function callOnce(params: NanoBananaParams) {
  const req = buildRequest(params);
  return generateText({
    model: toGatewayModel(params.model),
    messages: req.messages,
    providerOptions: req.providerOptions as Parameters<typeof generateText>[0]['providerOptions'],
  });
}

export async function generate(
  params: NanoBananaParams,
  _opts?: { noChatFallback?: boolean },
): Promise<GenerationResult> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new ProviderError('AI_GATEWAY_API_KEY no configurada', 'auth', false);
  }
  const RETRY_DELAYS = [2000, 5000, 10000];
  let attempt = 0;
  for (;;) {
    try {
      const result = await callOnce(params);
      const generation = interpretResult(result);

      if (params.noBackground) {
        const sharp = (await import('sharp')).default;
        const { data, info } = await sharp(generation.buffer)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const threshold = 250;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > threshold && data[i + 1] > threshold && data[i + 2] > threshold) {
            data[i + 3] = 0;
          }
        }
        generation.buffer = await sharp(data, {
          raw: { width: info.width, height: info.height, channels: 4 },
        }).png().toBuffer();
        generation.mimeType = 'image/png';
      }

      return generation;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (APICallError.isInstance(err)) {
        const status = err.statusCode;
        if (status === 429 && attempt < RETRY_DELAYS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
          attempt += 1;
          continue;
        }
        if (status === 429) {
          throw new ProviderError('Rate limit del proveedor. Intenta de nuevo en unos segundos.', 'rate_limit', true);
        }
        if (status === 401 || status === 403) {
          throw new ProviderError('Auth inválida con AI Gateway', 'auth', false);
        }
        // Fallback de chat conversacional: si el provider rechaza el
        // thought_signature replayado, reintentar UNA vez en single-turn.
        if (
          !_opts?.noChatFallback &&
          params.previousTurn?.thoughtSignature &&
          isChatSignatureRejection(status, err.message)
        ) {
          return generate(
            { ...params, previousTurn: { ...params.previousTurn, thoughtSignature: undefined } },
            { noChatFallback: true },
          );
        }
        if (status === 400) {
          throw new ProviderError(err.message.slice(0, 300), 'invalid_input', false);
        }
        if (status !== undefined && status >= 500) {
          throw new ProviderError(err.message.slice(0, 300), 'server', true);
        }
        throw new ProviderError(err.message.slice(0, 300), 'unknown', false);
      }
      throw new ProviderError(
        err instanceof Error ? err.message : 'error desconocido',
        'unknown',
        false,
      );
    }
  }
}
