import { describe, it, expect } from 'vitest';
import { buildPanelAssetImages } from './panel-asset';
import { imageIdsFromAssetImages } from './asset-images';

describe('buildPanelAssetImages', () => {
  it('junta el panel + refs del beat, dedup y sin null', () => {
    const out = buildPanelAssetImages({
      name: 'Panel 2',
      panelImageId: 'p1',
      beatReferenceIds: ['r1', 'p1', 'r2'], // p1 duplica el panel
      scenePrompt: 'una escena',
      aspectRatio: '9:16',
    });
    expect(out.assetType).toBe('panel');
    expect(out.name).toBe('Panel 2');
    expect(out.panelImageId).toBe('p1');
    expect(out.cleanReferenceIds).toEqual(['p1', 'r1', 'r2']);
    expect(out.scenePrompt).toBe('una escena');
    expect(out.aspectRatio).toBe('9:16');
  });

  it('panel null: cleanReferenceIds son solo las refs del beat', () => {
    const out = buildPanelAssetImages({
      name: 'Panel 1',
      panelImageId: null,
      beatReferenceIds: ['r1', 'r1', 'r2'],
      scenePrompt: '',
      aspectRatio: null,
    });
    expect(out.panelImageId).toBeNull();
    expect(out.cleanReferenceIds).toEqual(['r1', 'r2']);
  });
});

describe('imageIdsFromAssetImages — panel', () => {
  it('devuelve cleanReferenceIds', () => {
    const ids = imageIdsFromAssetImages({
      assetType: 'panel',
      name: 'Panel 1',
      panelImageId: 'p1',
      cleanReferenceIds: ['p1', 'r1'],
      scenePrompt: '',
      aspectRatio: null,
    });
    expect(ids).toEqual(['p1', 'r1']);
  });
});
