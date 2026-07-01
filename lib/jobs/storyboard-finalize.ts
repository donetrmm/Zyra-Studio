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

// Post-step del storyboard tras finalize (mueve lo que hacia el server action inline):
// promueve el output ya subido a media_reference y lo linkea al campaign_item.
// Best-effort: un fallo aqui no invalida la generacion ya 'done' (solo se loguea).
export async function promoteStoryboardPanel(gen: GenerationRow): Promise<void> {
  const itemId = storyboardCampaignItemId(gen);
  if (!itemId) return;
  const admin = createAdminClient();
  const { data } = await admin.from('generations').select('output_url').eq('id', gen.id).single();
  const outputUrl = (data as { output_url?: string | null } | null)?.output_url ?? null;
  if (!outputUrl) return;
  const imageId = await promoteOutputToReference(gen.workspace_id, gen.user_id, outputUrl, gen.id);
  await admin
    .from('campaign_items')
    .update({ storyboard_image_id: imageId, storyboard_generation_id: gen.id })
    .eq('id', itemId);
}
