// Historial de versiones de un panel: cada generacion 'done' de un beat es una
// version restaurable (la media_reference de su promote sigue en storage). Puro:
// la pagina hace la query slim (JSON path) y esto agrupa por beat, mas reciente
// primero, con tope por beat para no inflar el payload de la vista.

export type PanelVersionRow = {
  id: string;
  created_at: string;
  beat_id: string | null;
  parent_generation_id: string | null;
};

export type PanelVersion = {
  id: string;
  createdAt: string;
  refine: boolean;
};

export function groupPanelVersions(
  rows: PanelVersionRow[],
  maxPerBeat: number,
): Record<string, PanelVersion[]> {
  const byBeat: Record<string, PanelVersion[]> = {};
  const sorted = [...rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  for (const r of sorted) {
    if (!r.beat_id) continue;
    const list = (byBeat[r.beat_id] ??= []);
    if (list.length >= maxPerBeat) continue;
    list.push({ id: r.id, createdAt: r.created_at, refine: r.parent_generation_id !== null });
  }
  return byBeat;
}
