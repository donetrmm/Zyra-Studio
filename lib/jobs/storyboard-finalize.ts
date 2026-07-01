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
// enlazado. Devuelve true si la gen enlazada es más reciente que esta. Puro.
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
    .select('storyboard_generation_id')
    .eq('id', itemId)
    .single();
  const linkedId =
    (itemRow as { storyboard_generation_id?: string | null } | null)?.storyboard_generation_id ?? null;
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
  }

  const imageId = await promoteOutputToReference(gen.workspace_id, gen.user_id, outputUrl, gen.id);
  await admin
    .from('campaign_items')
    .update({ storyboard_image_id: imageId, storyboard_generation_id: gen.id })
    .eq('id', itemId);
}
