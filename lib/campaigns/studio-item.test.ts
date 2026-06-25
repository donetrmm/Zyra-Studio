import { describe, it, expect } from 'vitest';
import { toStudioItem } from './studio-item';

const maps = () => ({
  fn: new Map<string, string>([['f1', 'Reseña']]),
  fd: new Map<string, string>([['f1', 'desc']]),
  cn: new Map<string, string>([['c1', 'Marco']]),
});

describe('toStudioItem — characterStateHint (P05)', () => {
  it('mapea character_state_hint de la fila', () => {
    const { fn, fd, cn } = maps();
    const item = toStudioItem(
      { id: 'i1', format_id: 'f1', scene_prompt: 'x', status: 'planned', character_state_hint: 'sudado' },
      fn, fd, cn,
    );
    expect(item.characterStateHint).toBe('sudado');
  });
  it('null cuando la columna falta o es null', () => {
    const { fn, fd, cn } = maps();
    const item = toStudioItem(
      { id: 'i2', format_id: 'f1', scene_prompt: 'x', status: 'planned' },
      fn, fd, cn,
    );
    expect(item.characterStateHint).toBeNull();
  });
});
