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
