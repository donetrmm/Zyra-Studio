import { describe, expect, it } from 'vitest';
import { groupSessions } from './sessions';
import type { LibraryGeneration } from './types';

function gen(id: string, parent: string | null, createdAt: string): LibraryGeneration {
  return {
    id, type: 'image', provider: 'nano-banana', model: 'gemini-3-pro-image-preview',
    prompt: id, status: 'done', thumbnailUrl: null, hasOutput: true, credits: 1,
    createdAt, parentGenerationId: parent, batchId: null, batchKind: null,
    campaignId: null, aspectRatio: null,
  };
}

describe('groupSessions', () => {
  it('agrupa una cadena A->B->C bajo la raiz A', () => {
    const sessions = groupSessions([
      gen('A', null, '2026-06-27T10:00:00Z'),
      gen('B', 'A', '2026-06-27T10:01:00Z'),
      gen('C', 'B', '2026-06-27T10:02:00Z'),
    ], 'recent');
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe('A');
    expect(sessions[0].head.id).toBe('A');
    expect(sessions[0].latest.id).toBe('C');
    expect(sessions[0].items.map((i) => i.id)).toEqual(['A', 'B', 'C']);
  });

  it('los items intra-sesion van cronologicos sin importar el sort', () => {
    const sessions = groupSessions([
      gen('C', 'B', '2026-06-27T10:02:00Z'),
      gen('A', null, '2026-06-27T10:00:00Z'),
      gen('B', 'A', '2026-06-27T10:01:00Z'),
    ], 'old');
    expect(sessions[0].items.map((i) => i.id)).toEqual(['A', 'B', 'C']);
  });

  it('ordena las sesiones por latest segun el sort', () => {
    const gens = [
      gen('A', null, '2026-06-27T10:00:00Z'),
      gen('X', null, '2026-06-27T12:00:00Z'),
    ];
    expect(groupSessions(gens, 'recent').map((s) => s.id)).toEqual(['X', 'A']);
    expect(groupSessions(gens, 'old').map((s) => s.id)).toEqual(['A', 'X']);
  });

  it('no se cuelga con un ciclo de parents', () => {
    const sessions = groupSessions([
      gen('A', 'B', '2026-06-27T10:00:00Z'),
      gen('B', 'A', '2026-06-27T10:01:00Z'),
    ], 'recent');
    expect(sessions.reduce((n, s) => n + s.items.length, 0)).toBe(2);
  });

  it('un parent fuera de la lista visible inicia su propia sesion', () => {
    const sessions = groupSessions([gen('B', 'A-ausente', '2026-06-27T10:00:00Z')], 'recent');
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe('B');
  });
});
