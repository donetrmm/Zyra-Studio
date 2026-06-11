'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { CreateFormatSchema } from '@/lib/schemas/campaigns';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

// Formatos custom del workspace (doc V2 §4.2: la taxonomía Zyra es seed
// editable y ampliable — el catálogo es del usuario, no de la plataforma).
// Los formatos de sistema (is_system) son de solo lectura; RLS lo refuerza.

export async function createFormatAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = CreateFormatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('formats')
    .insert({
      slug: parsed.data.slug,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      register: parsed.data.register ?? null,
      camera_style: parsed.data.cameraStyle ?? null,
      pacing: parsed.data.pacing ?? null,
      required_refs: parsed.data.requiredRefs,
      default_duration_s: parsed.data.defaultDurationS,
      default_audio: parsed.data.defaultAudio,
      is_system: false,
      workspace_id: workspace.id,
    })
    .select('id')
    .single();
  if (error || !data) {
    const message = error?.code === '23505' ? 'Ya existe un formato con ese slug' : error?.message;
    return { ok: false, error: 'internal_error', message };
  }
  revalidatePath('/app/formats');
  return { ok: true, data: { id: data.id as string } };
}

export async function updateFormatAction(id: string, input: unknown): Promise<Result<{ updated: true }>> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'validation_error' };
  const parsed = CreateFormatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { error, count } = await supabase
    .from('formats')
    .update(
      {
        slug: parsed.data.slug,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        register: parsed.data.register ?? null,
        camera_style: parsed.data.cameraStyle ?? null,
        pacing: parsed.data.pacing ?? null,
        required_refs: parsed.data.requiredRefs,
        default_duration_s: parsed.data.defaultDurationS,
        default_audio: parsed.data.defaultAudio,
      },
      { count: 'exact' },
    )
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .eq('is_system', false);
  if (error) {
    const message = error.code === '23505' ? 'Ya existe un formato con ese slug' : error.message;
    return { ok: false, error: 'internal_error', message };
  }
  if (!count) return { ok: false, error: 'not_found', message: 'Formato no editable' };
  revalidatePath('/app/formats');
  return { ok: true, data: { updated: true } };
}

export async function deleteFormatAction(id: string): Promise<Result<{ deleted: true }>> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'validation_error' };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { error } = await supabase
    .from('formats')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .eq('is_system', false);
  if (error) {
    // FK desde campaign_items: el formato está en uso en alguna campaña.
    const message =
      error.code === '23503'
        ? 'El formato está en uso por items de campaña; elimina esos items primero'
        : error.message;
    return { ok: false, error: 'internal_error', message };
  }
  revalidatePath('/app/formats');
  return { ok: true, data: { deleted: true } };
}
