import { describe, it, expect } from 'vitest';
import { groupPanelVersions } from './storyboard-versions';

const row = (id: string, beat: string | null, createdAt: string, parent: string | null = null) => ({
  id,
  created_at: createdAt,
  beat_id: beat,
  parent_generation_id: parent,
});

describe('groupPanelVersions', () => {
  it('agrupa por beat, mas reciente primero, y marca los refinados', () => {
    const rows = [
      row('g1', 'b1', '2026-07-02T04:00:00Z'),
      row('g3', 'b1', '2026-07-02T04:20:00Z', 'g2'),
      row('g2', 'b1', '2026-07-02T04:10:00Z', 'g1'),
      row('g4', 'b2', '2026-07-02T04:05:00Z'),
    ];
    const out = groupPanelVersions(rows, 6);
    expect(out.b1.map((v) => v.id)).toEqual(['g3', 'g2', 'g1']);
    expect(out.b1.map((v) => v.refine)).toEqual([true, true, false]);
    expect(out.b2).toHaveLength(1);
  });

  it('respeta el tope por beat (conserva las mas recientes)', () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      row(`g${i}`, 'b1', `2026-07-02T04:0${i}:00Z`),
    );
    const out = groupPanelVersions(rows, 6);
    expect(out.b1).toHaveLength(6);
    expect(out.b1[0].id).toBe('g8');
  });

  it('ignora filas sin beat', () => {
    const out = groupPanelVersions([row('gx', null, '2026-07-02T04:00:00Z')], 6);
    expect(Object.keys(out)).toHaveLength(0);
  });
});
