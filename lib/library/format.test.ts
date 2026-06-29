import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAMPAIGN_NONE,
  aspectRatioToNumber,
  batchLabel,
  bucketOf,
  extFromMime,
  generationToModelKey,
  modelLabel,
  reuseHref,
  shortTime,
} from './format';
import type { LibraryGeneration } from './types';

const baseGen: LibraryGeneration = {
  id: '11111111-2222-3333-4444-555555555555',
  type: 'image', provider: 'nano-banana', model: 'gemini-3-pro-image-preview',
  prompt: 'un gato astronauta', status: 'done', thumbnailUrl: null, hasOutput: true,
  credits: 4, createdAt: '2026-06-27T12:00:00.000Z', parentGenerationId: null,
  batchId: null, batchKind: null, campaignId: null, aspectRatio: '16:9',
};

describe('modelLabel', () => {
  it('mapea modelos conocidos y cae a provider/model', () => {
    expect(modelLabel({ provider: 'nano-banana', model: 'gemini-3-pro-image-preview' })).toBe('Nano Banana Pro');
    expect(modelLabel({ provider: 'nano-banana', model: 'gemini-3.1-flash-image-preview' })).toBe('Nano Flash');
    expect(modelLabel({ provider: 'flux', model: 'flux-2-pro-preview' })).toBe('FLUX 2 Pro');
    expect(modelLabel({ provider: 'veo', model: 'veo-3.1-generate-preview' })).toBe('veo/veo-3.1-generate-preview');
  });
});

describe('generationToModelKey', () => {
  it('flux/nano-flash/nano-pro y fallback auto', () => {
    expect(generationToModelKey({ provider: 'flux', model: 'x' })).toBe('flux');
    expect(generationToModelKey({ provider: 'nano-banana', model: 'gemini-3.1-flash-image-preview' })).toBe('nano-flash');
    expect(generationToModelKey({ provider: 'nano-banana', model: 'gemini-3-pro-image-preview' })).toBe('nano-pro');
    expect(generationToModelKey({ provider: 'veo', model: 'veo-3.1-generate-preview' })).toBe('auto');
  });
});

describe('extFromMime', () => {
  it('mapea mimes con fallback jpg (incluye ogg)', () => {
    expect(extFromMime('image/png')).toBe('png');
    expect(extFromMime('image/webp')).toBe('webp');
    expect(extFromMime('video/mp4')).toBe('mp4');
    expect(extFromMime('video/webm')).toBe('webm');
    expect(extFromMime('audio/mpeg')).toBe('mp3');
    expect(extFromMime('audio/mp3')).toBe('mp3');
    expect(extFromMime('audio/wav')).toBe('wav');
    expect(extFromMime('audio/ogg')).toBe('ogg');
    expect(extFromMime('image/jpeg')).toBe('jpg');
    expect(extFromMime('application/octet-stream')).toBe('jpg');
  });
});

describe('batchLabel', () => {
  it('etiqueta por tipo de batch', () => {
    expect(batchLabel('storyboard')).toBe('SB');
    expect(batchLabel('variations')).toBe('VAR');
    expect(batchLabel('smart_crop')).toBe('CROP');
    expect(batchLabel('otro')).toBe('BATCH');
  });
});

describe('reuseHref', () => {
  it('arma la URL con prompt/aspect/model y rutea por tipo', () => {
    const href = reuseHref(baseGen);
    const qs = new URLSearchParams(href.split('?')[1]);
    expect(href.startsWith('/app/create/image?')).toBe(true);
    expect(qs.get('prompt')).toBe('un gato astronauta');
    expect(qs.get('aspect')).toBe('16:9');
    expect(qs.get('model')).toBe('nano-pro');
    expect(reuseHref({ ...baseGen, type: 'video' }).startsWith('/app/create/video?')).toBe(true);
    expect(reuseHref({ ...baseGen, type: 'audio' }).startsWith('/app/create/audio?')).toBe(true);
  });
});

describe('aspectRatioToNumber', () => {
  it('parsea w:h, null -> 1, divisor 0 -> 1, basura -> 1', () => {
    expect(aspectRatioToNumber('16:9')).toBeCloseTo(16 / 9);
    expect(aspectRatioToNumber('1:1')).toBe(1);
    expect(aspectRatioToNumber(null)).toBe(1);
    expect(aspectRatioToNumber('1:0')).toBe(1);
    expect(aspectRatioToNumber('texto')).toBe(1);
  });
});

describe('bucketOf / shortTime', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-27T15:00:00')); });
  afterEach(() => { vi.useRealTimers(); });
  it('bucketOf agrupa por recencia', () => {
    expect(bucketOf(new Date('2026-06-27T08:00:00').toISOString())).toBe('Hoy');
    expect(bucketOf(new Date('2026-06-26T23:00:00').toISOString())).toBe('Ayer');
    expect(bucketOf(new Date('2026-06-23T10:00:00').toISOString())).toBe('Esta semana');
    expect(bucketOf(new Date('2026-02-10T10:00:00').toISOString())).toMatch(/^[A-ZÁÉÍÓÚ]/);
    expect(bucketOf(new Date('2024-03-10T10:00:00').toISOString())).toMatch(/2024$/);
  });
  it('shortTime prefija Hoy/Ayer', () => {
    expect(shortTime(new Date('2026-06-27T08:30:00').toISOString())).toMatch(/^Hoy · /);
    expect(shortTime(new Date('2026-06-26T08:30:00').toISOString())).toMatch(/^Ayer · /);
  });
});

it('CAMPAIGN_NONE es el sentinel esperado', () => {
  expect(CAMPAIGN_NONE).toBe('__none__');
});
