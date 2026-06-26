// Agrupa los beats de un storyboard en CREATIVOS. Un creativo es un campaign_item
// independiente (sequence_id null) o una secuencia (varios items con el mismo
// sequence_id). Funcion pura para poder testearla sin BD.

export type StoryboardCreative = {
  // sequence_id ?? item.id — identifica al creativo en el select y para filtrar beats.
  key: string;
  label: string;
  kind: 'sequence' | 'single';
  sequenceId: string | null;
  // Item representativo: para un suelto es el item; para una secuencia, el primer beat.
  representativeItemId: string;
  // Ids de los beats del creativo, ordenados por scene_index.
  beatIds: string[];
};

// Fila minima para agrupar (la pagina la arma desde campaign_items + formats).
export type CreativeRow = {
  id: string;
  sequenceId: string | null;
  sequenceLabel: string | null;
  formatName: string | null;
  sceneIndex: number;
  createdAt: string;
};

const SEQUENCE_FALLBACK = 'Secuencia';
const SINGLE_FALLBACK = 'Creativo';

// Agrupa por clave (sequence_id ?? id), ordena los beats de cada creativo por
// scene_index, ordena los creativos por el created_at mas temprano de sus beats, y
// desambigua labels repetidos con un sufijo numerico 1-based.
export function buildCreatives(rows: CreativeRow[]): StoryboardCreative[] {
  type Group = {
    key: string;
    sequenceId: string | null;
    rows: CreativeRow[];
    minCreatedAt: string;
  };

  const groups = new Map<string, Group>();
  for (const row of rows) {
    const key = row.sequenceId ?? row.id;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
      if (row.createdAt < existing.minCreatedAt) existing.minCreatedAt = row.createdAt;
    } else {
      groups.set(key, {
        key,
        sequenceId: row.sequenceId,
        rows: [row],
        minCreatedAt: row.createdAt,
      });
    }
  }

  const ordered = [...groups.values()].sort((a, b) => {
    if (a.minCreatedAt !== b.minCreatedAt) return a.minCreatedAt < b.minCreatedAt ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const creatives: StoryboardCreative[] = ordered.map((g) => {
    const beats = [...g.rows].sort((a, b) => {
      if (a.sceneIndex !== b.sceneIndex) return a.sceneIndex - b.sceneIndex;
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    });
    const kind: 'sequence' | 'single' = g.sequenceId ? 'sequence' : 'single';
    const head = beats[0];
    const rawLabel =
      kind === 'sequence'
        ? head.sequenceLabel?.trim() || SEQUENCE_FALLBACK
        : head.formatName?.trim() || SINGLE_FALLBACK;
    return {
      key: g.key,
      label: rawLabel,
      kind,
      sequenceId: g.sequenceId,
      representativeItemId: head.id,
      beatIds: beats.map((b) => b.id),
    };
  });

  // Desambiguar labels repetidos: si un label aparece >1, sufijo 1-based por orden.
  const counts = new Map<string, number>();
  for (const c of creatives) counts.set(c.label, (counts.get(c.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const c of creatives) {
    if ((counts.get(c.label) ?? 0) > 1) {
      const n = (seen.get(c.label) ?? 0) + 1;
      seen.set(c.label, n);
      c.label = `${c.label} ${n}`;
    }
  }

  return creatives;
}
