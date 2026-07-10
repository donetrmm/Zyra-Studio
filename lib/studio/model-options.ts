// Catálogo del selector de modelos del estudio. Puro y client-safe: el compositor
// lo consume para pintar el selector y el control de variante/calidad, y para
// derivar el {provider, model, variant} exacto que espera SubmitStudioTurnSchema
// (Fase 1). Los literales deben calzar con NANO_MODELS/GPT_MODELS de ese schema.

export type StudioModelKey =
  | 'nano-pro'
  | 'nano-flash'
  | 'gpt-image-2'
  | 'gpt-image-1'
  | 'gpt-image-1-mini'
  | 'flux-2-pro'
  | 'flux-2-max';

export type StudioProviderKind = 'nano-banana' | 'gpt-image' | 'flux';

export type StudioVariantControl =
  | { kind: 'resolution'; options: string[] }
  | { kind: 'quality'; options: string[] }
  | { kind: 'none' };

export const STUDIO_MODELS: { key: StudioModelKey; label: string; sub: string }[] = [
  { key: 'nano-pro', label: 'Nano Banana Pro', sub: 'Gemini 3 Pro Image' },
  { key: 'nano-flash', label: 'Nano Flash', sub: 'Gemini 3.1 Flash' },
  { key: 'gpt-image-2', label: 'GPT Image 2', sub: 'OpenAI (calidad configurable)' },
  { key: 'gpt-image-1', label: 'GPT Image 1', sub: 'OpenAI' },
  { key: 'gpt-image-1-mini', label: 'GPT Image 1 Mini', sub: 'OpenAI (rápido)' },
  { key: 'flux-2-pro', label: 'FLUX.2 Pro', sub: 'Black Forest Labs (realismo)' },
  { key: 'flux-2-max', label: 'FLUX.2 Max', sub: 'Black Forest Labs (máxima calidad)' },
];

export function variantControlFor(key: StudioModelKey): StudioVariantControl {
  if (key === 'nano-pro') return { kind: 'resolution', options: ['1k', '2k', '4k'] };
  if (key === 'nano-flash') return { kind: 'resolution', options: ['1k', '2k'] };
  if (key === 'gpt-image-2') return { kind: 'quality', options: ['low', 'medium', 'high'] };
  return { kind: 'none' };
}

export function defaultVariantFor(key: StudioModelKey): string {
  if (key === 'nano-pro' || key === 'nano-flash') return '2k';
  if (key === 'gpt-image-2') return 'medium';
  return 'default';
}

export function resolveSelection(
  key: StudioModelKey,
  variant: string,
): { provider: StudioProviderKind; model: string; variant: string } {
  if (key === 'nano-pro') {
    return { provider: 'nano-banana', model: 'gemini-3-pro-image-preview', variant };
  }
  if (key === 'nano-flash') {
    return { provider: 'nano-banana', model: 'gemini-3.1-flash-image-preview', variant };
  }
  if (key === 'flux-2-pro' || key === 'flux-2-max') {
    // FLUX por el gateway (bfl/…): la key ES el model_id.
    return { provider: 'flux', model: key, variant };
  }
  // gpt-image-2 | gpt-image-1 | gpt-image-1-mini: la key ES el model_id.
  return { provider: 'gpt-image', model: key, variant };
}

export function maxReferencesFor(provider: StudioProviderKind, hasBase: boolean): number {
  // gpt-image: el gateway acepta 4 imágenes de entrada; con base ocupa un cupo.
  // nano y flux: SubmitStudioTurnSchema limita referenceIds a 6; con base, 5.
  const cap = provider === 'gpt-image' ? 4 : 6;
  return hasBase ? cap - 1 : cap;
}
