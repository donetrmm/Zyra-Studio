// Helpers PUROS de la vista de campaña (CampaignStudioView). Sin DB ni
// 'use client': agrupacion por formato para Produccion y armado de avisos del
// reproceso. Una sola fuente de verdad, testeable bajo vitest.
import type { StudioItem } from '@/lib/campaigns/studio-item';

export type FormatGroup = { formatId: string; formatName: string; items: StudioItem[] };

// Agrupa los items por formato preservando el orden de primera aparicion.
export function groupItemsByFormat(items: StudioItem[]): FormatGroup[] {
  const map = new Map<string, FormatGroup>();
  for (const item of items) {
    const key = item.formatId ?? 'sin-formato';
    const entry = map.get(key) ?? { formatId: item.formatId ?? '', formatName: item.formatName, items: [] };
    entry.items.push(item);
    map.set(key, entry);
  }
  return [...map.values()];
}

export type ReprocessPlanData = { inventedNames?: string[] | null; blockers?: string[] | null };

// Avisos NO silenciosos tras un reproceso exitoso (source === 'ideas'):
// personajes inventados e ideas no convertibles.
export function buildReprocessNotes(data: ReprocessPlanData): string[] {
  const notes: string[] = [];
  if (data.inventedNames?.length) {
    notes.push(
      `${data.inventedNames.join(', ')}: no está(n) en la campaña, se inventó su apariencia (sin imagen de referencia).`,
    );
  }
  if (data.blockers?.length) {
    notes.push(
      `No pude convertir algunas ideas en tomas: ${data.blockers.join(' · ')}. Reescríbelas con una acción concreta.`,
    );
  }
  return notes;
}
