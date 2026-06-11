// Metadata compartida entre el panel de controles de video y el preview.
// Vive fuera de los componentes 'use client' para poder consumirlo desde
// server-side helpers si más adelante hace falta (estimación de cobro, etc.).

import type { ModelKey } from '@/components/generation/VideoControlsPanel';

export const MODEL_LABEL: Record<ModelKey, string> = {
  'fal-ai/kling-video/v3/standard/text-to-video': 'Kling 3.0 Standard',
  'fal-ai/kling-video/v3/pro/text-to-video': 'Kling 3.0 Pro',
  'veo-3.1-fast-generate-preview': 'Veo 3.1 Fast',
  'veo-3.1-generate-preview': 'Veo 3.1 Standard',
  'veo-3.1-lite-generate-preview': 'Veo 3.1 Lite',
  'seedance-2.0': 'Seedance 2.0',
  'seedance-2.0-fast': 'Seedance 2.0 Fast',
};

// ETA en segundos basado en heurísticas por proveedor. Es una estimación proxy
// para que el usuario tenga expectativa; el tiempo real depende del proveedor
// y del rate limit del momento. Seedance: medido en smoke (clip fast de 4s ≈ 105s).
export function estimateVideoEta(
  model: ModelKey,
  klingDuration: number,
  veoDuration: 4 | 6 | 8,
  veoResolution: '720p' | '1080p',
  seedanceDuration = 8,
): number {
  if (model.startsWith('fal-ai/kling')) {
    return Math.round(klingDuration * 5 + 10);
  }
  if (model === 'seedance-2.0-fast') return 50 + seedanceDuration * 14;
  if (model === 'seedance-2.0') return 80 + seedanceDuration * 18;
  if (model === 'veo-3.1-fast-generate-preview') return 30 + veoDuration * 2;
  if (model === 'veo-3.1-lite-generate-preview') return 25 + veoDuration * 2;
  // Veo Standard
  return (veoResolution === '1080p' ? 60 : 40) + veoDuration * 4;
}
