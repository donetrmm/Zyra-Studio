import { describe, it, expect } from 'vitest';
import { directorContextFor, type CampaignContext } from './orchestrator';

// ItemRow mínimo: directorContextFor solo lee scene, character ids y formato.
const item = {
  id: 'i1',
  scene: null,
  character_id: null,
  character_ids: null,
} as unknown as Parameters<typeof directorContextFor>[0];

function ctxWith(audioRefPath?: string): CampaignContext {
  return {
    productName: 'Serum',
    productImagePaths: ['ws/p.png'],
    packagingImagePaths: [],
    characters: new Map(),
    language: 'es',
    ...(audioRefPath ? { audioRefPath } : {}),
  };
}

describe('directorContextFor — audioRefPath (P16)', () => {
  it('propaga audioRefPath del CampaignContext al DirectorContext', () => {
    const dc = directorContextFor(item, null, ctxWith('ws/u/beat.mp3'));
    expect(dc.audioRefPath).toBe('ws/u/beat.mp3');
  });
  it('sin pista, audioRefPath queda undefined', () => {
    const dc = directorContextFor(item, null, ctxWith());
    expect(dc.audioRefPath).toBeUndefined();
  });
});

describe('directorContextFor — productImageUsages (AM)', () => {
  it('propaga productImageUsages al imageUsages del producto (AM)', () => {
    const ctx: CampaignContext = {
      productName: 'Serum',
      productImagePaths: ['ws/a.png', 'ws/b.png'],
      productImageUsages: { 'ws/b.png': 'three-quarter view' },
      packagingImagePaths: [],
      characters: new Map(),
      language: 'es',
    };
    const dc = directorContextFor(item, null, ctx);
    expect(dc.product?.imageUsages).toEqual({ 'ws/b.png': 'three-quarter view' });
  });
});

describe('directorContextFor — character_state_hint (P05)', () => {
  it('sustituye el master por la variante de estado y setea stateLabel (P05)', () => {
    const ctx: CampaignContext = {
      productName: 'Serum', productImagePaths: [], packagingImagePaths: [],
      characters: new Map([['c1', {
        name: 'Marcela', description: 'x', masterImagePath: 'ws/master.png',
        angleImagePaths: [], states: { sudado: 'ws/sweaty.png' },
      }]]),
      language: 'es',
    };
    const sweaty = { id: 'i1', character_ids: ['c1'], character_id: null, scene: null, character_state_hint: 'sudado' } as unknown as Parameters<typeof directorContextFor>[0];
    const dc = directorContextFor(sweaty, null, ctx);
    expect(dc.characters?.[0].masterImagePath).toBe('ws/sweaty.png');
    expect(dc.characters?.[0].stateLabel).toBe('sudado');

    const neutral = { id: 'i2', character_ids: ['c1'], character_id: null, scene: null, character_state_hint: null } as unknown as Parameters<typeof directorContextFor>[0];
    const dc2 = directorContextFor(neutral, null, ctx);
    expect(dc2.characters?.[0].masterImagePath).toBe('ws/master.png');
    expect(dc2.characters?.[0].stateLabel).toBeUndefined();
  });
});
