import { describe, it, expect } from 'vitest';
import {
  ACTING_RESTRAINT_DIRECTION,
  ACTING_ENERGETIC_DIRECTION,
  actingDirectionFor,
  declaresHighEmotion,
  facesIntended,
} from './acting';

describe('declaresHighEmotion', () => {
  it('detecta emoción grande (en y es)', () => {
    expect(declaresHighEmotion('she screams at him')).toBe(true);
    expect(declaresHighEmotion('rompe en llanto frente a la cámara')).toBe(true);
  });
  it('no marca una acción tranquila', () => {
    expect(declaresHighEmotion('she lifts the can and smiles softly')).toBe(false);
  });
});

describe('actingDirectionFor', () => {
  it('emoción alta declarada -> null (deja pasar la emoción)', () => {
    expect(actingDirectionFor('cinematic brand film', true)).toBeNull();
  });
  it('registro enérgico -> variante enérgica controlada', () => {
    expect(actingDirectionFor('bold kinetic dance', false)).toBe(ACTING_ENERGETIC_DIRECTION);
  });
  it('registro neutro -> base restraint', () => {
    expect(actingDirectionFor('testimonio cercano', false)).toBe(ACTING_RESTRAINT_DIRECTION);
  });
});

describe('facesIntended', () => {
  it('true con personaje del Cast (hoja maestra)', () => {
    expect(
      facesIntended(
        { characters: [{ name: 'Pedro', description: 'x', masterImagePath: 'ws/p.png' }] },
        false,
      ),
    ).toBe(true);
  });
  it('true con hablante en cámara aunque no haya Cast', () => {
    expect(facesIntended({}, true)).toBe(true);
  });
  it('false en clip de puro producto', () => {
    expect(facesIntended({ product: { name: 'Canvas', imagePaths: ['ws/p.png'] } }, false)).toBe(false);
  });
});
