// Detecta paneles de storyboard cuyo promote se perdió: la generación 'done' más
// reciente de cada beat debería ser la enlazada (storyboard_generation_id). Si no
// lo es, ese promote murió (encolado fallido o job agotó reintentos) y hay que
// re-encolarlo. Puro: la página hace las queries y este helper decide.

export type HealGenRow = { id: string; created_at: string; params: Record<string, unknown> };
export type HealItemRow = { id: string; storyboard_generation_id: string | null };

export function findUnpromotedPanels(gens: HealGenRow[], items: HealItemRow[]): string[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const newestByBeat = new Map<string, HealGenRow>();
  for (const g of gens) {
    const sb = (g.params ?? {}) as { storyboard?: { campaignItemId?: unknown } };
    const beatId = sb.storyboard?.campaignItemId;
    if (typeof beatId !== 'string' || !itemById.has(beatId)) continue;
    const cur = newestByBeat.get(beatId);
    if (!cur || new Date(g.created_at).getTime() > new Date(cur.created_at).getTime()) {
      newestByBeat.set(beatId, g);
    }
  }
  const out: string[] = [];
  for (const [beatId, g] of newestByBeat) {
    if (itemById.get(beatId)!.storyboard_generation_id !== g.id) out.push(g.id);
  }
  return out;
}
