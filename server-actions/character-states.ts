'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

export const CreateCharacterStateSchema = z.object({
  characterId: z.string().uuid(),
  label: z.string().trim().min(1).max(40),
  stateImageId: z.string().uuid(),
  description: z.string().trim().max(300).optional(),
});

async function ownsImage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('media_references').select('id, workspace_id, type').eq('id', id).single();
  return !!data && data.workspace_id === workspaceId && data.type === 'image';
}

export async function createCharacterStateAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = CreateCharacterStateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  // ownership del personaje
  const { data: ch } = await supabase
    .from('characters').select('id, workspace_id').eq('id', parsed.data.characterId).single();
  if (!ch || ch.workspace_id !== workspace.id) return { ok: false, error: 'not_found', message: 'Personaje no encontrado' };
  if (!(await ownsImage(supabase, workspace.id, parsed.data.stateImageId))) {
    return { ok: false, error: 'forbidden', message: 'Imagen no pertenece al workspace' };
  }
  const { data: row, error } = await supabase
    .from('character_states')
    .insert({
      workspace_id: workspace.id,
      character_id: parsed.data.characterId,
      label: parsed.data.label,
      state_image_id: parsed.data.stateImageId,
      description: parsed.data.description ?? null,
    })
    .select('id').single();
  if (error || !row) return { ok: false, error: 'internal_error', message: error?.message ?? 'no row' };
  revalidatePath('/app/brand/cast');
  return { ok: true, data: { id: row.id as string } };
}

export async function listCharacterStatesAction(
  characterId: unknown,
): Promise<Result<Array<{ id: string; label: string; stateImageId: string | null; description: string | null }>>> {
  if (typeof characterId !== 'string') return { ok: false, error: 'validation_error' };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data } = await supabase
    .from('character_states')
    .select('id, label, state_image_id, description')
    .eq('character_id', characterId)
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: true });
  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.id as string,
      label: r.label as string,
      stateImageId: (r.state_image_id as string | null) ?? null,
      description: (r.description as string | null) ?? null,
    })),
  };
}

export async function deleteCharacterStateAction(id: unknown): Promise<Result<{ id: string }>> {
  if (typeof id !== 'string') return { ok: false, error: 'validation_error' };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('character_states').delete().eq('id', id).eq('workspace_id', workspace.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/brand/cast');
  return { ok: true, data: { id } };
}
