import type { LibraryGeneration, Session, SortKey } from './types';

export function groupSessions(gens: LibraryGeneration[], sort: SortKey): Session[] {
  // Para cadenas conversacionales A→B→C→D, el bucket es la RAÍZ del hilo (A),
  // no el parent inmediato. Iteramos hacia atrás hasta encontrar un item sin
  // parent (o uno cuyo parent no esté en la lista visible). El guard `visited`
  // evita loops en caso de datos corruptos con ciclos.
  const byId = new Map(gens.map((g) => [g.id, g]));
  function rootOf(g: LibraryGeneration): string {
    let cur = g;
    const visited = new Set<string>([cur.id]);
    while (cur.parentGenerationId) {
      const parent = byId.get(cur.parentGenerationId);
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      cur = parent;
    }
    return cur.id;
  }

  const map = new Map<string, LibraryGeneration[]>();
  for (const g of gens) {
    const key = rootOf(g);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(g);
  }
  const sessions: Session[] = [];
  for (const [id, items] of map.entries()) {
    // Dentro de la sesión las variaciones van siempre cronológicas (v1, v2…),
    // independientemente del sort externo.
    items.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const head = items.find((i) => i.id === id) ?? items[0];
    const latest = items[items.length - 1];
    sessions.push({ id, items, head, latest });
  }
  sessions.sort((a, b) => {
    const ta = new Date(a.latest.createdAt).getTime();
    const tb = new Date(b.latest.createdAt).getTime();
    return sort === 'old' ? ta - tb : tb - ta;
  });
  return sessions;
}
