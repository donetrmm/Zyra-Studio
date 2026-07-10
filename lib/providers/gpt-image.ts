import 'server-only';
import { generateImage } from 'ai';
import { ProviderError, type GenerationResult, type ImageReference } from '@/lib/providers/types';

// GPT Image por el Vercel AI Gateway (mismo AI_GATEWAY_API_KEY que Nano). A
// diferencia de Nano (generateText -> result.files), aquí se usa generateImage
// -> result.images[].base64. La edición pasa las referencias como prompt.images
// (base + refs, máx 4 por el gateway). El base64 encaja con la regla de que el
// worker sube a Supabase (nunca una URL de proveedor llega al cliente).

export type GptImageModel = 'gpt-image-2' | 'gpt-image-1' | 'gpt-image-1-mini';
export type GptImageQuality = 'low' | 'medium' | 'high';

export type GptImageParams = {
  model: GptImageModel;
  prompt: string;
  size?: string;
  quality?: GptImageQuality; // solo gpt-image-2
  references?: ImageReference[]; // base + refs para editar
};

function toOpenAIGatewayModel(model: GptImageModel): string {
  return `openai/${model}`;
}

export function buildImageRequest(params: GptImageParams): {
  model: string;
  prompt: string | { text: string; images: Buffer[] };
  size?: string;
  providerOptions?: Record<string, unknown>;
} {
  const refs = params.references ?? [];
  const prompt =
    refs.length > 0 ? { text: params.prompt, images: refs.map((r) => r.buffer) } : params.prompt;
  const providerOptions =
    params.model === 'gpt-image-2' && params.quality
      ? { openai: { quality: params.quality } }
      : undefined;
  return {
    model: toOpenAIGatewayModel(params.model),
    prompt,
    ...(params.size ? { size: params.size } : {}),
    ...(providerOptions ? { providerOptions } : {}),
  };
}

export function interpretImageResult(result: {
  images: Array<{ base64: string; mediaType?: string }>;
}): GenerationResult {
  const image = result.images[0];
  if (!image) throw new ProviderError('gpt-image no devolvió imagen', 'unknown', false);
  return { buffer: Buffer.from(image.base64, 'base64'), mimeType: image.mediaType ?? 'image/png' };
}

export async function generate(params: GptImageParams): Promise<GenerationResult> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new ProviderError('AI_GATEWAY_API_KEY no configurada', 'auth', false);
  }
  const req = buildImageRequest(params);
  try {
    // req.model (string) y req.prompt (string | { text, images: Buffer[] })
    // encajan directo en los tipos públicos del SDK (ImageModel/GenerateImagePrompt
    // aceptan ambas formas). size y providerOptions sí necesitan cast: el SDK
    // tipa size como plantilla `${number}x${number}` (nosotros lo guardamos como
    // string libre) y providerOptions exige valores JSONValue, no unknown
    // (verificado por smoke, no por API real).
    const result = await generateImage({
      model: req.model,
      prompt: req.prompt,
      ...(req.size ? { size: req.size as Parameters<typeof generateImage>[0]['size'] } : {}),
      ...(req.providerOptions
        ? { providerOptions: req.providerOptions as Parameters<typeof generateImage>[0]['providerOptions'] }
        : {}),
    });
    return interpretImageResult(
      result as unknown as { images: Array<{ base64: string; mediaType?: string }> },
    );
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    const message = err instanceof Error ? err.message : 'error desconocido de gpt-image';
    const status = (err as { statusCode?: number } | null)?.statusCode;
    const code = status === 429 ? 'rate_limit' : status === 401 || status === 403 ? 'auth' : 'unknown';
    throw new ProviderError(message, code, code === 'rate_limit');
  }
}
