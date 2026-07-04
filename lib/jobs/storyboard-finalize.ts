import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { promoteOutputToReference } from '@/lib/supabase/storage';
import type { GenerationRow } from './handlers/types';

// Extrae el campaignItemId si esta generacion es un panel de storyboard.
export function storyboardCampaignItemId(gen: GenerationRow): string | null {
  const sb = (gen.params as { storyboard?: { campaignItemId?: unknown } }).storyboard;
  const id = sb?.campaignItemId;
  return typeof id === 'string' ? id : null;
}

// Un promote reintentado (QStash) o tardío no debe pisar un panel más nuevo ya
// enlazado. Devuelve true si lo enlazado (gen o media_reference manual) es más
// reciente que esta gen. Puro.
export function isStalePromote(
  genCreatedAt: string | null,
  linkedCreatedAt: string | null | undefined,
): boolean {
  if (!genCreatedAt || !linkedCreatedAt) return false;
  return new Date(linkedCreatedAt).getTime() > new Date(genCreatedAt).getTime();
}

// Post-step del storyboard tras finalize (mueve lo que hacia el server action inline):
// promueve el output ya subido a media_reference y lo linkea al campaign_item.
// Idempotente (guard por storyboard_generation_id) y con guard de frescura: seguro
// de reintentar — el worker devuelve 500 si falla y QStash lo reintenta.
export async function promoteStoryboardPanel(gen: GenerationRow): Promise<void> {
  const itemId = storyboardCampaignItemId(gen);
  if (!itemId) return;
  const admin = createAdminClient();

  const { data: itemRow } = await admin
    .from('campaign_items')
    .select('storyboard_generation_id, storyboard_image_id')
    .eq('id', itemId)
    .single();
  const item = itemRow as
    | { storyboard_generation_id?: string | null; storyboard_image_id?: string | null }
    | null;
  const linkedId = item?.storyboard_generation_id ?? null;
  // Idempotencia: este promote ya corrió (retry de QStash) — nada que hacer.
  if (linkedId === gen.id) return;

  const { data } = await admin
    .from('generations')
    .select('output_url, created_at')
    .eq('id', gen.id)
    .single();
  const row = data as { output_url?: string | null; created_at?: string | null } | null;
  const outputUrl = row?.output_url ?? null;
  if (!outputUrl) return;

  if (linkedId) {
    const { data: linked } = await admin
      .from('generations')
      .select('created_at')
      .eq('id', linkedId)
      .single();
    const linkedCreatedAt = (linked as { created_at?: string } | null)?.created_at;
    if (isStalePromote(row?.created_at ?? null, linkedCreatedAt)) return;
  } else if (item?.storyboard_image_id) {
    // Beat enlazado a una imagen SIN generación: panel manual (upload). Un promote
    // tardío no debe pisarlo si la subida es posterior a esta gen.
    const { data: linkedRef } = await admin
      .from('media_references')
      .select('created_at')
      .eq('id', item.storyboard_image_id)
      .single();
    const refCreatedAt = (linkedRef as { created_at?: string } | null)?.created_at;
    if (isStalePromote(row?.created_at ?? null, refCreatedAt)) return;
  }

  const imageId = await promoteOutputToReference(gen.workspace_id, gen.user_id, outputUrl, gen.id);
  const { error: linkErr } = await admin
    .from('campaign_items')
    .update({ storyboard_image_id: imageId, storyboard_generation_id: gen.id })
    .eq('id', itemId);
  // Sin throw, un link fallido dejaba la gen con media_reference pero sin enlazar,
  // y el heal (que decide por existencia de la ref) ya no la rescataría: 500 aquí
  // hace que QStash reintente el promote completo.
  if (linkErr) throw new Error(`promote link failed: ${linkErr.message}`);
}
