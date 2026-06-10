'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

// Cast de personajes (doc V2 §4.4): hoja maestra obligatoria — la misma
// imagen se inyecta en TODAS las generaciones donde aparece el personaje.
const UpsertCharacterSchema = z.object({
  name: z.string().trim().min(1).max(80),
  // Apariencia, vestuario y manera de actuar. Los marcadores de edad los
  // limpia el Prompt Director al compilar.
  description: z.string().trim().max(600).optional(),
  masterImageId: z.string().uuid(),
  angleImageIds: z.array(z.string().uuid()).max(2).default([]),
});

async function validateImageOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  ids: string[],
): Promise<boolean> {
  if (ids.length === 0) return true;
  const { data: refs } = await supabase
    .from('media_references')
    .select('id, workspace_id, type')
    .in('id', ids);
  const valid = new Set(
    (refs ?? [])
      .filter((r) => r.workspace_id === workspaceId && r.type === 'image')
      .map((r) => r.id as string),
  );
  return ids.every((id) => valid.has(id));
}

export async function createCharacterAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = UpsertCharacterSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const allIds = [parsed.data.masterImageId, ...parsed.data.angleImageIds];
  if (!(await validateImageOwnership(supabase, workspace.id, allIds))) {
    return { ok: false, error: 'forbidden', message: 'Imagen no pertenece al workspace' };
  }

  const { data, error } = await supabase
    .from('characters')
    .insert({
      workspace_id: workspace.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      master_image_id: parsed.data.masterImageId,
      angle_image_ids: parsed.data.angleImageIds,
      reference_image_ids: allIds, // compat V1: generación suelta usa este campo
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'internal_error', message: error?.message };
  revalidatePath('/app/cast');
  return { ok: true, data: { id: data.id as string } };
}

export async function updateCharacterAction(id: string, input: unknown): Promise<Result<{ updated: true }>> {
  const parsed = UpsertCharacterSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const allIds = [parsed.data.masterImageId, ...parsed.data.angleImageIds];
  if (!(await validateImageOwnership(supabase, workspace.id, allIds))) {
    return { ok: false, error: 'forbidden', message: 'Imagen no pertenece al workspace' };
  }

  const { error } = await supabase
    .from('characters')
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      master_image_id: parsed.data.masterImageId,
      angle_image_ids: parsed.data.angleImageIds,
      reference_image_ids: allIds,
    })
    .eq('id', id)
    .eq('workspace_id', workspace.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/cast');
  return { ok: true, data: { updated: true } };
}

export async function deleteCharacterAction(id: string): Promise<Result<{ deleted: true }>> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'validation_error' };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('characters')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspace.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/cast');
  return { ok: true, data: { deleted: true } };
}
