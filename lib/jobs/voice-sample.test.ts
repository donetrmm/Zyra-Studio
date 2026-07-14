import { describe, expect, it } from 'vitest';
import { seedanceVoiceVariantPath, SEEDANCE_VOICE_TRIM_S } from './voice-sample';
import { buildAudioTrimArgs } from './video-frame';

describe('seedanceVoiceVariantPath', () => {
  it('deriva la variante junto al original, reemplazando la extensión', () => {
    expect(seedanceVoiceVariantPath('ws/uploaded/sample.mp3')).toBe(
      `ws/uploaded/sample.seedance-${SEEDANCE_VOICE_TRIM_S}s.mp3`,
    );
    expect(seedanceVoiceVariantPath('ws/uploaded/sample.WAV')).toBe(
      `ws/uploaded/sample.seedance-${SEEDANCE_VOICE_TRIM_S}s.mp3`,
    );
  });

  it('es idempotente: la variante de una variante es ella misma', () => {
    const variant = seedanceVoiceVariantPath('ws/uploaded/sample.mp3');
    expect(seedanceVoiceVariantPath(variant)).toBe(variant);
  });
});

describe('buildAudioTrimArgs', () => {
  it('recorta a N segundos con re-encode mp3 (la duración del contenedor debe ser la recortada)', () => {
    const args = buildAudioTrimArgs('in.mp3', 'out.mp3', 12);
    expect(args).toContain('-t');
    expect(args[args.indexOf('-t') + 1]).toBe('12');
    expect(args).toContain('libmp3lame');
    expect(args[args.length - 1]).toBe('out.mp3');
  });
});
