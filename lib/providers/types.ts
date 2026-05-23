import 'server-only';

export type ImageReference = {
  buffer: Buffer;
  mimeType: string;
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
};

export type FluxParams = {
  prompt: string;
  width: number;
  height: number;
  references?: ImageReference[];
  promptUpsampling?: boolean;
  seed?: number;
  safetyTolerance?: number;
};

export type GenerationResult = {
  buffer: Buffer;
  mimeType: string;
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
