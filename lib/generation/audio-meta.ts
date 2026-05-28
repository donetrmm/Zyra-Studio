// Metadata compartida entre el panel de controles de audio y el preview.
// Vive fuera de los componentes 'use client' para poder consumirla desde
// server-side helpers si más adelante hace falta.

import type { TTS_MODELS } from '@/lib/schemas/audio';

export const MODEL_LABEL: Record<(typeof TTS_MODELS)[number], string> = {
  eleven_multilingual_v2: 'Multilingual v2',
  eleven_flash_v2_5: 'Flash v2.5',
  eleven_v3: 'Eleven v3',
};

// ETA grosera del tiempo de síntesis: base + chars/throughput.
// ElevenLabs procesa ~80 chars/seg en Flash, menos en v2/v3. Cap a 60s.
export function estimateAudioEta(text: string, modelId: (typeof TTS_MODELS)[number]): number {
  const chars = Math.max(text.trim().length, 1);
  const throughput = modelId === 'eleven_flash_v2_5' ? 120 : modelId === 'eleven_v3' ? 60 : 80;
  return Math.min(60, Math.max(2, Math.round(2 + chars / throughput)));
}
