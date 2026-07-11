import 'server-only';
import sharp from 'sharp';
import { APICallError, generateImage } from 'ai';
import { ProviderError, type GenerationResult } from './types';

// Outpaint de la zona segura (4:5 -> 9:16) por el Vercel AI Gateway con FLUX.1 Fill
// [pro] (slug bfl/flux-pro-1.0-fill). Mismo AI_GATEWAY_API_KEY que Nano/gpt-image/
// flux-gateway; reemplaza el endpoint BFL directo /v1/flux-pro-1.0-expand (submit +
// poll + download con BFL_API_KEY) que existia aqui.
//
// El expand por bandas se traduce a un fill con mascara: la base 4:5 se centra en un
// canvas 9:16 (bandas arriba/abajo) y una mascara marca en BLANCO las bandas a generar
// y en NEGRO la base a preservar. El modelo regenera SOLO el blanco, asi que la base
// 4:5 queda intacta — misma garantia que daba el expand. El resultado es base64 -> el
// worker lo sube a Supabase (ninguna URL de proveedor llega al cliente).
//
// El fill corre dentro de UNA invocacion del worker (maxDuration 60s). pollTimeoutMillis
// 50s deja margen para armado + descarga y evita el kill por 60s que dejaba la
// generacion colgada en 'processing' (incidente 2026-07-03).

const FILL_MODEL = 'bfl/flux-pro-1.0-fill';
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 50_000;

export type ExpandParams = {
  image: Buffer;
  top: number;
  bottom: number;
  left?: number;
  right?: number;
  prompt: string;
  safetyTolerance?: number;
};

// Arma el canvas 9:16 (base centrada + bandas negras) y la mascara B/N del mismo
// tamaño (bandas blancas = generar, base negra = preservar). Pura salvo por sharp
// (sin red) -> testeable de forma determinista. Las bandas del canvas son negras
// porque son irrelevantes: el fill las regenera donde la mascara es blanca.
export async function buildFillCanvasAndMask(params: ExpandParams): Promise<{
  canvas: Buffer;
  mask: Buffer;
  width: number;
  height: number;
}> {
  const top = Math.max(0, Math.round(params.top));
  const bottom = Math.max(0, Math.round(params.bottom));
  const left = Math.max(0, Math.round(params.left ?? 0));
  const right = Math.max(0, Math.round(params.right ?? 0));

  const meta = await sharp(params.image).metadata();
  const baseW = meta.width ?? 0;
  const baseH = meta.height ?? 0;
  if (!baseW || !baseH) {
    throw new ProviderError('fill: no se pudieron leer las dimensiones de la base', 'invalid_input', false);
  }

  const width = baseW + left + right;
  const height = baseH + top + bottom;

  const canvas = await sharp(params.image)
    .extend({ top, bottom, left, right, background: { r: 0, g: 0, b: 0 } })
    .jpeg()
    .toBuffer();

  // Mascara: lienzo blanco (generar) con un recorte negro (preservar) del tamaño de
  // la base compuesto en su posicion. PNG lossless para que el borde base/banda no
  // se ensucie con grises por artefactos JPEG.
  const baseBlack = await sharp({
    create: { width: baseW, height: baseH, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  const mask = await sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: baseBlack, top, left }])
    .png()
    .toBuffer();

  return { canvas, mask, width, height };
}

// Arma el request del AI SDK para el fill. Pura (sin red) -> test determinista.
// Las referencias de edicion (imagen base) viajan en prompt.images y la mascara en
// prompt.mask, ambas como Buffer (mismo canal que flux-gateway usa para las refs).
// Los ajustes nativos de BFL van por providerOptions.blackForestLabs (passthrough
// del gateway); se manda tambien bajo 'bfl' por el namespace ambiguo del slug, igual
// que flux-gateway con las dimensiones.
export function buildFillRequest(
  canvas: Buffer,
  mask: Buffer,
  prompt: string,
  safetyTolerance?: number,
): {
  model: string;
  prompt: { text: string; images: Buffer[]; mask: Buffer };
  providerOptions: Record<string, Record<string, unknown>>;
} {
  const bflOptions = {
    outputFormat: 'jpeg',
    safetyTolerance: safetyTolerance ?? 2,
    pollIntervalMillis: POLL_INTERVAL_MS,
    pollTimeoutMillis: POLL_TIMEOUT_MS,
  };
  return {
    model: FILL_MODEL,
    prompt: { text: prompt, images: [canvas], mask },
    providerOptions: { blackForestLabs: bflOptions, bfl: bflOptions },
  };
}

export function interpretImageResult(result: {
  images: Array<{ base64: string; mediaType?: string }>;
}): GenerationResult {
  const image = result.images[0];
  if (!image) throw new ProviderError('FLUX Fill (gateway) no devolvio imagen', 'unknown', false);
  return { buffer: Buffer.from(image.base64, 'base64'), mimeType: image.mediaType ?? 'image/jpeg' };
}

export async function expand(params: ExpandParams): Promise<GenerationResult> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new ProviderError('AI_GATEWAY_API_KEY no configurada', 'auth', false);
  }
  const { canvas, mask } = await buildFillCanvasAndMask(params);
  const req = buildFillRequest(canvas, mask, params.prompt, params.safetyTolerance);
  try {
    // prompt ({ text, images, mask }) y providerOptions necesitan cast: el SDK tipa
    // prompt como string | GenerateImagePrompt y providerOptions como JSONValue.
    // Mismo patron de cast que flux-gateway.ts / gpt-image.ts.
    const result = await generateImage({
      model: req.model,
      prompt: req.prompt as Parameters<typeof generateImage>[0]['prompt'],
      providerOptions: req.providerOptions as Parameters<typeof generateImage>[0]['providerOptions'],
    });
    return interpretImageResult(
      result as unknown as { images: Array<{ base64: string; mediaType?: string }> },
    );
  } catch (err) {
    throw translateError(err);
  }
}

// Espeja translateError de flux-gateway.ts / gpt-image.ts (mismo AI Gateway): 429 ->
// rate_limit, 401/403 -> auth, 5xx -> server (retryable), resto -> unknown.
function translateError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (APICallError.isInstance(err)) {
    const status = err.statusCode ?? 0;
    if (status === 429) return new ProviderError('Rate limit FLUX Fill (gateway)', 'rate_limit', true);
    if (status === 401 || status === 403) {
      return new ProviderError('Auth invalida con AI Gateway (FLUX Fill)', 'auth', false);
    }
    return new ProviderError(
      `FLUX Fill (gateway) ${status}: ${err.message.slice(0, 200)}`,
      'server',
      status >= 500,
    );
  }
  return new ProviderError(
    `FLUX Fill (gateway): ${err instanceof Error ? err.message : 'error desconocido'}`,
    'unknown',
    false,
  );
}
