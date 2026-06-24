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
