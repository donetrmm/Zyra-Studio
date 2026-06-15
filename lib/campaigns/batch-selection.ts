// Selección de items de un lote (specs/v2/03 tarea 5). Pura y testeable (sin DB
// ni 'server-only'): la consume enqueueBatch. Separa la regla de negocio de los
// efectos para poder probarla en node.

// Lo mínimo que la selección necesita de un item; estructural para no acoplar a
// ItemRow ni arrastrar 'server-only' al test.
type SelectableRow = {
  id: string;
  scene: string | null;
  sequence_id: string | null;
  scene_index: number | null;
};

// Tamaño de la muestra: cuántos creativos SUELTOS rinde 'sample'.
export const SAMPLE_SIZE = 2;

// Orden narrativo: las escenas de una secuencia van por scene_index; los
// sueltos (scene_index null → 0) quedan estables en su orden de entrada.
function bySceneIndex(a: SelectableRow, b: SelectableRow): number {
  return (a.scene_index ?? 0) - (b.scene_index ?? 0);
}

// Qué items encolar de un lote ya filtrado a 'pending'.
// - 'full': todos, en orden narrativo.
// - 'sample': una secuencia es ATÓMICA — la muestra nunca rinde media historia.
//   Se muestrea solo sobre creativos sueltos (sin sequence_id), con escenas
//   distintas para que sea representativa; si no hay sueltos (grupo
//   solo-secuencia) la muestra cae a la secuencia COMPLETA y en orden, nunca a
//   un subconjunto parcial.
export function selectBatchItems<T extends SelectableRow>(
  pending: T[],
  mode: 'sample' | 'full',
): T[] {
  if (mode === 'full') return [...pending].sort(bySceneIndex);

  const loose = pending.filter((i) => i.sequence_id == null);
  if (loose.length === 0) return [...pending].sort(bySceneIndex);

  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of loose) {
    const key = item.scene ?? item.id;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
    if (out.length >= SAMPLE_SIZE) break;
  }
  // Menos escenas distintas que el tamaño de muestra: completa con los primeros
  // sueltos (escena repetida es preferible a una muestra incompleta).
  return out.length < SAMPLE_SIZE ? loose.slice(0, SAMPLE_SIZE) : out;
}
