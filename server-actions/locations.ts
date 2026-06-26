'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { UpsertLocationSchema } from '@/lib/schemas/locations';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

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

export async function createLocationAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = UpsertLocationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const allIds = [parsed.data.masterImageId, parsed.data.scaleMapImageId, ...parsed.data.referenceImageIds].filter(
    (x): x is string => !!x,
  );
  if (!(await validateImageOwnership(supabase, workspace.id, allIds))) {
    return { ok: false, error: 'forbidden', message: 'Imagen no pertenece al workspace' };
  }

  const { data, error } = await supabase
    .from('locations')
    .insert({
      workspace_id: workspace.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      master_image_id: parsed.data.masterImageId ?? null,
      reference_image_ids: parsed.data.referenceImageIds,
      scale_map_image_id: parsed.data.scaleMapImageId ?? null,
      scale_map_notes: parsed.data.scaleMapNotes ?? null,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'internal_error', message: error?.message };
  revalidatePath('/app/brand/locations');
  return { ok: true, data: { id: data.id as string } };
}

export async function updateLocationAction(id: string, input: unknown): Promise<Result<{ updated: true }>> {
  const parsed = UpsertLocationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const allIds = [parsed.data.masterImageId, parsed.data.scaleMapImageId, ...parsed.data.referenceImageIds].filter(
    (x): x is string => !!x,
  );
  if (!(await validateImageOwnership(supabase, workspace.id, allIds))) {
    return { ok: false, error: 'forbidden', message: 'Imagen no pertenece al workspace' };
  }

  const { error, count } = await supabase
    .from('locations')
    .update(
      {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        master_image_id: parsed.data.masterImageId ?? null,
        reference_image_ids: parsed.data.referenceImageIds,
        scale_map_image_id: parsed.data.scaleMapImageId ?? null,
        scale_map_notes: parsed.data.scaleMapNotes ?? null,
      },
      { count: 'exact' },
    )
    .eq('id', id)
    .eq('workspace_id', workspace.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  if (!count) return { ok: false, error: 'not_found' };
  revalidatePath('/app/brand/locations');
  return { ok: true, data: { updated: true } };
}

export async function deleteLocationAction(id: string): Promise<Result<{ deleted: true }>> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'validation_error' };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('locations')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspace.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/brand/locations');
  return { ok: true, data: { deleted: true } };
}
