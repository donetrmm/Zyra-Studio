'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

const CampaignSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function createCampaignAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = CampaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      workspace_id: workspace.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      color: parsed.data.color ?? '#7c3aed',
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'internal_error', message: error?.message };
  revalidatePath('/app/campaigns');
  return { ok: true, data: { id: data.id as string } };
}

export async function updateCampaignAction(id: string, input: unknown): Promise<Result<{ updated: true }>> {
  const parsed = CampaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('campaigns')
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      color: parsed.data.color,
    })
    .eq('id', id)
    .eq('workspace_id', workspace.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/campaigns');
  return { ok: true, data: { updated: true } };
}

export async function deleteCampaignAction(id: string): Promise<Result<{ deleted: true }>> {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspace.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/campaigns');
  return { ok: true, data: { deleted: true } };
}

export async function assignCampaignAction(
  generationId: string,
  campaignId: string | null,
): Promise<Result<{ assigned: true }>> {
  const { user } = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('generations')
    .update({ campaign_id: campaignId })
    .eq('id', generationId)
    .eq('user_id', user.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/library');
  revalidatePath('/app/campaigns');
  return { ok: true, data: { assigned: true } };
}

export async function listCampaignsAction(): Promise<Result<{ id: string; name: string; color: string }[]>> {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, name, color')
    .eq('workspace_id', workspace.id)
    .order('name');
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  return { ok: true, data: (data ?? []) as { id: string; name: string; color: string }[] };
}
