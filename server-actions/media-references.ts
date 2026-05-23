'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  CreateMediaReferenceSchema,
  GetUploadUrlSchema,
} from '@/lib/schemas/generations';
import {
  REFERENCES_BUCKET,
  createReferenceUploadUrl,
  downloadOutputBuffer,
  publicThumbnailUrl,
} from '@/lib/supabase/storage';

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

const UseGenerationAsRefSchema = z.object({
  generationId: z.string().uuid(),
});

function extFromMime(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

// Copia el output de una generación al bucket de referencias y registra una
// media_reference (source='generation', source_generation_id=gen).
// La copia es necesaria porque downloadReferenceBuffer lee solo del bucket
// REFERENCES; outputs vive en su propio bucket con policies distintas.
export async function addGenerationAsReferenceAction(
  input: unknown,
): Promise<
  Result<{ id: string; storagePath: string; previewUrl: string; filename: string }>
> {
  const parsed = UseGenerationAsRefSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }

  try {
    const { user, workspace } = await requireWorkspace();
    const supabase = await createClient();

    const { data: gen, error: genErr } = await supabase
      .from('generations')
      .select('id, workspace_id, output_url, thumbnail_url, status')
      .eq('id', parsed.data.generationId)
      .single();
    if (genErr || !gen) {
      return { ok: false, error: 'internal_error', message: genErr?.message ?? 'no row' };
    }
    if (gen.workspace_id !== workspace.id) {
      return { ok: false, error: 'unauthenticated', message: 'forbidden' };
    }
    if (gen.status !== 'done' || !gen.output_url) {
      return { ok: false, error: 'validation_error', message: 'generación sin output' };
    }

    const { buffer, mimeType } = await downloadOutputBuffer(gen.output_url);
    const ext = extFromMime(mimeType);
    const filename = `generation-${gen.id.slice(0, 8)}.${ext}`;
    const path = `${workspace.id}/${user.id}/${crypto.randomUUID()}-${filename}`;

    const admin = createAdminClient();
    const { error: upErr } = await admin.storage
      .from(REFERENCES_BUCKET)
      .upload(path, buffer, { contentType: mimeType, upsert: false });
    if (upErr) {
      return { ok: false, error: 'internal_error', message: upErr.message };
    }

    const { data: row, error: insErr } = await supabase
      .from('media_references')
      .insert({
        workspace_id: workspace.id,
        user_id: user.id,
        type: 'image',
        storage_url: path,
        name: filename,
        source: 'generation',
        source_generation_id: gen.id,
      })
      .select('id')
      .single();
    if (insErr || !row) {
      // Cleanup del archivo subido si la inserción falla.
      await admin.storage.from(REFERENCES_BUCKET).remove([path]).catch(() => {});
      return { ok: false, error: 'internal_error', message: insErr?.message ?? 'no row' };
    }

    const previewUrl = gen.thumbnail_url ? publicThumbnailUrl(gen.thumbnail_url) : '';
    revalidatePath('/app/library');
    return {
      ok: true,
      data: { id: row.id as string, storagePath: path, previewUrl, filename },
    };
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
