'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

const UpsertSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  referenceImageIds: z.array(z.string().uuid()).max(5).optional(),
});

export async function listCharactersAction(): Promise<Result<unknown[]>> {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('characters')
    .select('*')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false });
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  return { ok: true, data: data ?? [] };
}

export async function createCharacterAction(
  input: unknown,
): Promise<Result<{ id: string }>> {
  const parsed = UpsertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('characters')
    .insert({
      workspace_id: workspace.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      reference_image_ids: parsed.data.referenceImageIds ?? [],
    })
    .select('id')
    .single();
  if (error || !data) {
    return { ok: false, error: 'internal_error', message: error?.message ?? 'insert failed' };
  }
  revalidatePath('/app/characters');
  return { ok: true, data: { id: data.id as string } };
}

export async function updateCharacterAction(
  id: string,
  input: unknown,
): Promise<Result<{ updated: true }>> {
  const parsed = UpsertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('characters')
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      reference_image_ids: parsed.data.referenceImageIds ?? [],
    })
    .eq('id', id);
  if (error) {
    return { ok: false, error: 'internal_error', message: error.message };
  }
  revalidatePath('/app/characters');
  return { ok: true, data: { updated: true } };
}

export async function deleteCharacterAction(
  id: string,
): Promise<Result<{ deleted: true }>> {
  await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('characters')
    .delete()
    .eq('id', id);
  if (error) {
    return { ok: false, error: 'internal_error', message: error.message };
  }
  revalidatePath('/app/characters');
  return { ok: true, data: { deleted: true } };
}
