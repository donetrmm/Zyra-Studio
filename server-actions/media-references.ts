'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import {
  CreateMediaReferenceSchema,
  GetUploadUrlSchema,
} from '@/lib/schemas/generations';
import { createReferenceUploadUrl } from '@/lib/supabase/storage';

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: 'validation_error' | 'unauthenticated' | 'internal_error'; message?: string };

export async function getUploadSignedUrlAction(
  input: unknown,
): Promise<Result<{ path: string; signedUrl: string; token: string }>> {
  const parsed = GetUploadUrlSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  try {
    const { user, workspace } = await requireWorkspace();
    const data = await createReferenceUploadUrl(workspace.id, user.id, parsed.data.filename);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: 'internal_error', message: (e as Error).message };
  }
}

export async function createMediaReferenceAction(
  input: unknown,
): Promise<Result<{ id: string; thumbnailUrl: string | null }>> {
  const parsed = CreateMediaReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  try {
    const { user, workspace } = await requireWorkspace();
    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from('media_references')
      .insert({
        workspace_id: workspace.id,
        user_id: user.id,
        type: parsed.data.type,
        storage_url: parsed.data.storagePath,
        name: parsed.data.name ?? null,
        source: 'upload',
      })
      .select('id, thumbnail_url')
      .single();
    if (error || !row) {
      return { ok: false, error: 'internal_error', message: error?.message ?? 'no row' };
    }
    revalidatePath('/app/library');
    return { ok: true, data: { id: row.id as string, thumbnailUrl: row.thumbnail_url ?? null } };
  } catch (e) {
    return { ok: false, error: 'internal_error', message: (e as Error).message };
  }
}

export async function deleteMediaReferenceAction(
  input: unknown,
): Promise<Result<{ id: string }>> {
  if (!input || typeof input !== 'object' || !('id' in input)) {
    return { ok: false, error: 'validation_error' };
  }
  const id = (input as { id: unknown }).id;
  if (typeof id !== 'string') return { ok: false, error: 'validation_error' };

  const { user } = await requireWorkspace();
  const supabase = await createClient();
  // RLS valida: owner puede borrar
  const { error } = await supabase
    .from('media_references')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/library');
  return { ok: true, data: { id } };
}
