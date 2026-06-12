// Agrupa los items del plan para la UI: las escenas de una misma secuencia se
// colapsan en un grupo ordenado por sceneIndex; los creativos normales quedan
// como 'single'. Mantiene el orden de primera aparición de cada secuencia.

export type PlanItemLike = {
  id: string;
  sequenceId: string | null;
  sceneIndex: number | null;
  sequenceLabel: string | null;
};

export type PlanGroup<T extends PlanItemLike> =
  | { kind: 'single'; item: T }
  | { kind: 'sequence'; sequenceId: string; label: string | null; scenes: T[] };

export function groupPlanItems<T extends PlanItemLike>(items: T[]): Array<PlanGroup<T>> {
  const out: Array<PlanGroup<T>> = [];
  const seqIndex = new Map<string, number>();

  for (const item of items) {
    if (item.sequenceId == null) {
      out.push({ kind: 'single', item });
      continue;
    }
    const at = seqIndex.get(item.sequenceId);
    if (at === undefined) {
      seqIndex.set(item.sequenceId, out.length);
      out.push({ kind: 'sequence', sequenceId: item.sequenceId, label: item.sequenceLabel, scenes: [item] });
    } else {
      (out[at] as Extract<PlanGroup<T>, { kind: 'sequence' }>).scenes.push(item);
    }
  }

  for (const g of out) {
    if (g.kind === 'sequence') {
      g.scenes.sort((a, b) => (a.sceneIndex ?? 0) - (b.sceneIndex ?? 0));
    }
  }
  return out;
}
