import { describe, it, expect } from 'vitest';
import {
  ACTING_RESTRAINT_DIRECTION,
  ACTING_ENERGETIC_DIRECTION,
  actingDirectionFor,
  declaresHighEmotion,
  facesIntended,
  findUnexpandedActions,
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
  it('registro festivo en español -> variante enérgica', () => {
    expect(actingDirectionFor('alegre/festivo', false)).toBe(ACTING_ENERGETIC_DIRECTION);
  });
  it('registro celebratorio en español -> variante enérgica', () => {
    expect(actingDirectionFor('tono celebración, dinámico', false)).toBe(ACTING_ENERGETIC_DIRECTION);
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

describe('findUnexpandedActions', () => {
  it('marca un verbo abstracto sin micro-acciones', () => {
    expect(findUnexpandedActions('he dances in the kitchen')).toContain('dances');
  });
  it('no marca un verbo ya desglosado en gestos', () => {
    expect(
      findUnexpandedActions('he dances: two head nods, a shoulder roll, a finger snap'),
    ).toHaveLength(0);
  });
  it('marca un estado de emoción crudo', () => {
    expect(findUnexpandedActions('she looks sad by the window')).toEqual(
      expect.arrayContaining(['looks sad']),
    );
  });
  it('no marca un beat desglosado en gerundios concretos', () => {
    expect(findUnexpandedActions('she celebrates, raising a glass and nodding')).toHaveLength(0);
  });
  it('no marca "plays" en uso de reproducción de media', () => {
    expect(findUnexpandedActions('the song plays as the logo appears on screen')).toHaveLength(0);
  });
});
