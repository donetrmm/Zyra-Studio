import { describe, it, expect } from 'vitest';
import {
  orderedSceneItems,
  firstSceneItem,
  nextSceneItem,
  shouldReturnLastFrame,
} from './sequence-chain';

const items = [
  { id: 'c', sceneIndex: 2 },
  { id: 'a', sceneIndex: 0 },
  { id: 'd', sceneIndex: 3 },
  { id: 'b', sceneIndex: 1 },
];

describe('sequence-chain', () => {
  it('ordena por sceneIndex', () => {
    expect(orderedSceneItems(items).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('firstSceneItem es la escena 0', () => {
    expect(firstSceneItem(items)?.id).toBe('a');
    expect(firstSceneItem([])).toBeNull();
  });

  it('nextSceneItem devuelve la escena siguiente o null al final', () => {
    expect(nextSceneItem(items, 0)?.id).toBe('b');
    expect(nextSceneItem(items, 1)?.id).toBe('c');
    expect(nextSceneItem(items, 3)).toBeNull();
  });

  it('shouldReturnLastFrame: true salvo en el último clip', () => {
    expect(shouldReturnLastFrame(items, 0)).toBe(true);
    expect(shouldReturnLastFrame(items, 2)).toBe(true);
    expect(shouldReturnLastFrame(items, 3)).toBe(false);
  });

  it('secuencia de 1: la única escena es la primera y no pide fotograma', () => {
    const one = [{ id: 'only', sceneIndex: 0 }];
    expect(firstSceneItem(one)?.id).toBe('only');
    expect(shouldReturnLastFrame(one, 0)).toBe(false);
    expect(nextSceneItem(one, 0)).toBeNull();
  });
});

import { regenModesFor } from './sequence-chain';

describe('regenModesFor', () => {
  const items = [
    { id: 'a', sceneIndex: 0 },
    { id: 'b', sceneIndex: 1 },
    { id: 'c', sceneIndex: 2 },
  ];

  it('clip del medio: ofrece anclaje y cascada', () => {
    expect(regenModesFor(items, 1)).toEqual({ onlyThis: true, thisAndForward: true });
  });

  it('primer clip: ningún modo especial (no tiene clip previo; se regenera normal)', () => {
    expect(regenModesFor(items, 0)).toEqual({ onlyThis: false, thisAndForward: false });
  });

  it('último clip: sin anclaje ni cascada (no hay siguiente)', () => {
    expect(regenModesFor(items, 2)).toEqual({ onlyThis: false, thisAndForward: false });
  });

  it('secuencia de un solo clip: ningún modo de secuencia', () => {
    expect(regenModesFor([{ id: 'x', sceneIndex: 0 }], 0)).toEqual({
      onlyThis: false,
      thisAndForward: false,
    });
  });
});

import { isLocationMode } from './sequence-chain';

describe('isLocationMode', () => {
  it('true cuando el item tiene location_id', () => {
    expect(isLocationMode({ location_id: 'loc-1' })).toBe(true);
  });
  it('false cuando location_id es null', () => {
    expect(isLocationMode({ location_id: null })).toBe(false);
  });
});

import { isStoryboardVideoMode } from './sequence-chain';

describe('isStoryboardVideoMode', () => {
  it('true cuando el item tiene storyboard_image_id', () => {
    expect(isStoryboardVideoMode({ storyboard_image_id: 'panel-1' })).toBe(true);
  });
  it('false cuando storyboard_image_id es null', () => {
    expect(isStoryboardVideoMode({ storyboard_image_id: null })).toBe(false);
  });
});
