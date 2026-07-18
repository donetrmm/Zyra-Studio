import { describe, it, expect } from 'vitest';
import {
  ACTING_RESTRAINT_DIRECTION,
  ACTING_ENERGETIC_DIRECTION,
  NATURAL_EXPRESSION_CLAUSE,
  PLANNER_ACTING_BLOCK,
  actingDirectionFor,
  declaresHighEmotion,
  facesIntended,
  findUnexpandedActions,
  findOvermechanicalActions,
} from './acting';
import { stripSlop } from './antislop';

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
    expect(facesIntended({ products: [{ name: 'Canvas', imagePaths: ['ws/p.png'] }] }, false)).toBe(false);
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

describe('findOvermechanicalActions', () => {
  it('marca el sentido de rotación', () => {
    expect(findOvermechanicalActions('the right hand rotates the cap counterclockwise')).toEqual(
      expect.arrayContaining(['counterclockwise']),
    );
  });
  it('marca grados explícitos', () => {
    expect(findOvermechanicalActions('she turns the lid at a 90-degree angle')).not.toHaveLength(0);
  });
  it('marca mano-estabiliza-mano', () => {
    expect(
      findOvermechanicalActions('she twists it while the left hand stabilizes the bottle'),
    ).not.toHaveLength(0);
  });
  it('marca mecánica articular nombrada', () => {
    expect(findOvermechanicalActions('he flexes the wrist and extends the elbow')).not.toHaveLength(0);
  });
  it('marca "joint by joint"', () => {
    expect(findOvermechanicalActions('the arm moves joint by joint to the shelf')).not.toHaveLength(0);
  });
  it('marca "muscle by muscle"', () => {
    expect(findOvermechanicalActions('she tenses muscle by muscle as she lifts')).not.toHaveLength(0);
  });
  it('marca articulación nombrada en español (respaldo)', () => {
    expect(findOvermechanicalActions('describe cada articulación de la muñeca')).not.toHaveLength(0);
  });
  it('marca sobre-mecánica en español (respaldo)', () => {
    expect(findOvermechanicalActions('gira la tapa en sentido antihorario')).not.toHaveLength(0);
  });
  it('NO marca las micro-acciones buenas de P14', () => {
    expect(
      findOvermechanicalActions('two head nods, a shoulder turn, a knee bend, a finger snap'),
    ).toHaveLength(0);
  });
  it('NO marca una acción intención-resultado normal', () => {
    expect(
      findOvermechanicalActions('she uncaps the bottle and sets it on the table'),
    ).toHaveLength(0);
  });
});

// Expresiones naturales (feedback 2026-07-04): la sobreactuación nace en el
// PANEL (sonrisa de anuncio) y en el ORIGEN (el planner escribe muecas grandes).
describe('NATURAL_EXPRESSION_CLAUSE', () => {
  it('es concatenable y frena la sonrisa de anuncio sin tocar la identidad', () => {
    expect(NATURAL_EXPRESSION_CLAUSE.startsWith(' ')).toBe(true);
    expect(NATURAL_EXPRESSION_CLAUSE).toMatch(/never wide forced advertising smiles/);
    expect(NATURAL_EXPRESSION_CLAUSE).toMatch(/exact identity/);
  });

  it('sin términos de la lista antislop', () => {
    expect(stripSlop(NATURAL_EXPRESSION_CLAUSE).removed).toEqual([]);
  });
});

describe('PLANNER_ACTING_BLOCK', () => {
  it('las emociones nacen como gestos pequeños, con la excepción declarada', () => {
    expect(PLANNER_ACTING_BLOCK.startsWith('\n')).toBe(true);
    expect(PLANNER_ACTING_BLOCK).toContain('ACTUACIÓN Y EXPRESIONES');
    expect(PLANNER_ACTING_BLOCK).toContain('salvo que la idea');
  });
});

// Auditoría BD 2026-07-04: guiones del planner previos al freno de expresión
// declaran alegría grande ("her face beaming with joy") que el detector no
// reconocía — la cláusula de contención se inyectaba EN CONTRA del guion.
describe('declaresHighEmotion — alegría grande declarada', () => {
  it('reconoce la alegría grande en inglés y español', () => {
    expect(declaresHighEmotion('her face beaming with joy')).toBe(true);
    expect(declaresHighEmotion('she is ecstatic, overjoyed by the gift')).toBe(true);
    expect(declaresHighEmotion('ríe a carcajadas al abrir la caja')).toBe(true);
  });

  it('no confunde "beam" de luz/estructura con la sonrisa', () => {
    expect(declaresHighEmotion('a beam of warm light crosses the room')).toBe(false);
    expect(declaresHighEmotion('sunlight beaming through the window')).toBe(false);
  });

  it('una sonrisa suave sigue sin contar como emoción grande', () => {
    expect(declaresHighEmotion('she lifts the can and smiles softly')).toBe(false);
  });
});
