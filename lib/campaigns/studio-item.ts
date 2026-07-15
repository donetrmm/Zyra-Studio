// Tipo y proyección compartidos de un campaign_item hacia la forma que consume
// el cliente (StudioItem). Módulo PURO (sin 'server-only' ni 'use client'): lo
// usan el loader del page, las server actions (crear serie, fusionar secuencia)
// y los componentes cliente. Una sola fuente de verdad para evitar drift entre
// las tres proyecciones que antes existían por separado.

export type StudioItem = {
  id: string;
  formatId: string | null;
  formatName: string;
  formatDescription: string;
  templateId: string | null;
  durationS: number | null;
  aspectRatio: string | null;
  scene: string | null;
  scenePrompt: string;
  // Resumen display en el idioma de la campaña (033); null cae a scenePrompt.
  sceneSummary: string | null;
  caption: string | null;
  characterNames: string[];
  scheduledDate: string | null;
  status: string;
  warnings: string[];
  generationId: string | null;
  isWinner: boolean;
  sequenceId: string | null;
  sceneIndex: number | null;
  sequenceLabel: string | null;
  locationId: string | null;
  // P05: estado físico fijado para este item (label de un estado horneado del
  // personaje), o null = master neutro. Lo fija el matcher (inferencia) o el
  // usuario (override en el editor).
  characterStateHint: string | null;
  // Vestuario (specs/v2/16): override de outfit para este item, por label
  // (labels de character_outfits del/de los personaje(s)). null = usa el
  // outfit de campaña (character_outfit_map) o el cuerpo completo base.
  characterOutfitHint: string | null;
  // Multi-producto (spec 2026-07-15): subconjunto del pool asignado al clip.
  // [] = sin asignar. Compat: filas pre-070 solo traen product_id.
  productIds: string[];
  // Nº de referencias extra (reference_ids) del clip — insumo del estimado de
  // presupuesto del badge; el contenido no se proyecta.
  extraRefCount: number;
  // V3 multi-producto (Fase 4): true si el clip tiene una selección MANUAL de
  // referencias propia (reference_selection jsonb no nulo). false = usa el
  // recorte automático del pool scopeado al clip. Solo indica presencia —
  // el contenido vive en reference_selection, no se proyecta aquí.
  hasManualRefs: boolean;
};

// Proyecta una fila cruda de campaign_items a StudioItem. Los nombres de formato
// y personaje se resuelven desde mapas (formato → nombre/descripción, id →
// nombre); el loader los arma una vez por lote y las actions con un solo formato
// pasan mapas de una entrada.
export function toStudioItem(
  row: Record<string, unknown>,
  formatNames: Map<string, string>,
  formatDescriptions: Map<string, string>,
  characterNameById: Map<string, string>,
): StudioItem {
  const formatId = (row.format_id as string | null) ?? null;
  const charIds =
    (row.character_ids as string[] | null) ?? (row.character_id ? [row.character_id as string] : []);
  return {
    id: row.id as string,
    formatId,
    formatName: formatId ? (formatNames.get(formatId) ?? 'Formato') : 'Formato',
    formatDescription: formatId ? (formatDescriptions.get(formatId) ?? '') : '',
    templateId: (row.template_id as string | null) ?? null,
    durationS: (row.duration_s as number | null) ?? null,
    aspectRatio: (row.aspect_ratio as string | null) ?? null,
    scene: (row.scene as string | null) ?? null,
    scenePrompt: row.scene_prompt as string,
    sceneSummary: (row.scene_summary as string | null) ?? null,
    caption: (row.caption as string | null) ?? null,
    characterNames: charIds
      .map((id) => characterNameById.get(id))
      .filter((n): n is string => !!n),
    scheduledDate: (row.scheduled_date as string | null) ?? null,
    status: row.status as string,
    warnings: (row.warnings as string[]) ?? [],
    generationId: (row.generation_id as string | null) ?? null,
    isWinner: (row.is_winner as boolean) ?? false,
    sequenceId: (row.sequence_id as string | null) ?? null,
    sceneIndex: (row.scene_index as number | null) ?? null,
    sequenceLabel: (row.sequence_label as string | null) ?? null,
    locationId: (row.location_id as string | null) ?? null,
    characterStateHint: (row.character_state_hint as string | null) ?? null,
    characterOutfitHint: (row.character_outfit_hint as string | null) ?? null,
    productIds:
      ((row.product_ids as string[] | null) ?? []).length > 0
        ? (row.product_ids as string[])
        : row.product_id
          ? [row.product_id as string]
          : [],
    extraRefCount: ((row.reference_ids as string[] | null) ?? []).length,
    hasManualRefs: (row.reference_selection as unknown) != null,
  };
}
