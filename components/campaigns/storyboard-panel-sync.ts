// Helpers puros de sincronización del estado de paneles del storyboard.
// Existen por el parpadeo de la grilla: cada router.refresh() re-firma TODAS las
// URLs de panel (createSignedUrl emite un token nuevo por llamada), y comparar la
// URL completa hacía que todos los <img> cambiaran de src (re-fetch + blink) en
// cada generación/refinado. Aquí se compara el ASSET (pathname), no el token.

export type PanelState =
  | { status: 'idle'; panelUrl: string | null }
  | { status: 'generating' }
  | { status: 'error'; message: string };

// Subconjunto del beat que necesita la sincronización.
type BeatSync = {
  id: string;
  panelUrl: string | null;
  storyboardGenerationId: string | null;
};

// ¿Apuntan las dos URLs al mismo asset de Storage? Ignora el query string (el
// token firmado cambia en cada render del server). Fallback a comparación cruda
// si el string no parsea como URL.
export function samePanelAsset(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return assetPath(a) === assetPath(b);
}

function assetPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

// Conserva la URL previa cuando la nueva es solo una re-firma del mismo asset:
// el <img> mantiene su src (la firma vieja sigue viva, TTL 24h) y el navegador
// no re-descarga nada. Solo cambia el src cuando el asset realmente cambió.
export function stabilizePanelUrls<T extends { id: string; panelUrl: string | null }>(
  prev: T[],
  next: T[],
): T[] {
  const prevById = new Map(prev.map((b) => [b.id, b]));
  return next.map((b) => {
    const p = prevById.get(b.id);
    if (!p || p.panelUrl === b.panelUrl) return b;
    if (samePanelAsset(p.panelUrl, b.panelUrl)) return { ...b, panelUrl: p.panelUrl };
    return b;
  });
}

// Reconcilia el mapa de estados por beat contra los beats frescos del server.
// Devuelve null si no hay cambios (misma ref para setState). Reglas:
// - entrada faltante: se crea idle.
// - idle: adopta la URL solo si el asset cambió (los beats ya vienen estabilizados).
// - generating: SOLO pasa a idle cuando el beat quedó enlazado a una generación
//   completada de este intento (completedByBeat). Sin esto, el flip prematuro
//   mostraba "Sin panel"/panel viejo entre el 'done' de Realtime y el promote.
// - error: no se pisa (lo limpia el próximo intento).
export function reconcilePanelStates(
  prev: Record<string, PanelState>,
  beats: BeatSync[],
  completedByBeat: Record<string, string[]>,
): Record<string, PanelState> | null {
  let changed = false;
  const next: Record<string, PanelState> = { ...prev };
  for (const b of beats) {
    const cur = prev[b.id];
    if (!cur) {
      next[b.id] = { status: 'idle', panelUrl: b.panelUrl };
      changed = true;
      continue;
    }
    if (cur.status === 'idle' && cur.panelUrl !== b.panelUrl) {
      next[b.id] = { status: 'idle', panelUrl: b.panelUrl };
      changed = true;
      continue;
    }
    if (
      cur.status === 'generating' &&
      b.storyboardGenerationId !== null &&
      (completedByBeat[b.id] ?? []).includes(b.storyboardGenerationId)
    ) {
      next[b.id] = { status: 'idle', panelUrl: b.panelUrl };
      changed = true;
    }
  }
  return changed ? next : null;
}

// Limpia el overlay "Refinando…" de los beats cuyo refinado ya quedó enlazado
// (mismo criterio que el flip de generating). Devuelve null si no hay cambios.
export function clearLinkedOverlays(
  prev: Record<string, boolean>,
  beats: BeatSync[],
  completedByBeat: Record<string, string[]>,
): Record<string, boolean> | null {
  let next: Record<string, boolean> | null = null;
  for (const b of beats) {
    if (
      prev[b.id] &&
      b.storyboardGenerationId !== null &&
      (completedByBeat[b.id] ?? []).includes(b.storyboardGenerationId)
    ) {
      if (!next) next = { ...prev };
      delete next[b.id];
    }
  }
  return next;
}
