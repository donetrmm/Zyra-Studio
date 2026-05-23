import 'server-only';

export type ImageReference = {
  buffer: Buffer;
  mimeType: string;
};

export type NanoBananaTurn = {
  prompt: string;
  imageBuffer: Buffer;
  mimeType: string;
  // Firma del razonamiento del modelo, devuelta por Gemini en el part de
  // inline_data. Obligatoria al reenviar el turn como role:'model' en chat
  // multi-turn con gemini-3-pro-image-preview (si falta → 400).
  thoughtSignature?: string;
};

export type NanoBananaParams = {
  model: 'gemini-3-pro-image-preview' | 'gemini-3.1-flash-image-preview';
  prompt: string;
  aspectRatio?: string;
  resolution?: '512' | '1K' | '2K' | '4K';
  references?: ImageReference[];
  useGrounding?: boolean;
  conversational?: boolean;
  hasTextInImage?: boolean;
  // Si presente, el adapter construye contents en formato chat multi-turn:
  // [user: prompt anterior, model: imagen anterior, user: nuevo prompt+refs].
  // Esto es lo que mantiene composición real al editar (no "pegar cara").
  previousTurn?: NanoBananaTurn | null;
};

export type FluxParams = {
  prompt: string;
  width: number;
  height: number;
  references?: ImageReference[];
  promptUpsampling?: boolean;
  seed?: number;
  safetyTolerance?: number;
  // 0–1. Qué tanto debe FLUX adherirse a las refs (identidad / composición).
  // Default alto: las refs deberían ANCLAR, no solo inspirar.
  imagePromptStrength?: number;
};

export type GenerationResult = {
  buffer: Buffer;
  mimeType: string;
  thoughtSignature?: string;
  meta?: Record<string, unknown>;
};

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'rate_limit'
      | 'auth'
      | 'safety'
      | 'invalid_input'
      | 'server'
      | 'timeout'
      | 'unknown',
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export const NANO_BANANA_MAX_REFS: Record<NanoBananaParams['model'], number> = {
  'gemini-3-pro-image-preview': 11,
  'gemini-3.1-flash-image-preview': 14,
};

export const FLUX_MAX_REFS = 8;
