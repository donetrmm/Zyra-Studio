'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { downloadReferenceBuffer } from '@/lib/supabase/storage';
import { describeCharacterImage } from '@/lib/cast/describe-character';

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

// Descripción age-blind desde la hoja maestra (el LLM VE la imagen). Best-effort:
// devuelve null si el storage o el proveedor fallan — nunca bloquea el alta del
// personaje. El ownership de la imagen debe haberse validado por el caller.
async function describeFromMaster(
  supabase: Awaited<ReturnType<typeof createClient>>,
  masterImageId: string,
): Promise<string | null> {
  const { data: ref } = await supabase
    .from('media_references')
    .select('storage_url')
    .eq('id', masterImageId)
    .single();
  if (!ref?.storage_url) return null;
  try {
    const { buffer, mimeType } = await downloadReferenceBuffer(ref.storage_url as string);
    return await describeCharacterImage({ imageBuffer: buffer, mimeType });
  } catch {
    return null;
  }
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

  // Sin descripción tecleada → se infiere de la hoja maestra (el modelo la VE),
  // para que el Prompt Director nunca ancle al personaje sin apariencia.
  const description =
    parsed.data.description ?? (await describeFromMaster(supabase, parsed.data.masterImageId));

  const { data, error } = await supabase
    .from('characters')
    .insert({
      workspace_id: workspace.id,
      name: parsed.data.name,
      description: description ?? null,
      master_image_id: parsed.data.masterImageId,
      angle_image_ids: parsed.data.angleImageIds,
      reference_image_ids: allIds, // compat V1: generación suelta usa este campo
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'internal_error', message: error?.message };
  revalidatePath('/app/brand/cast');
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

  // Igual que en el alta: descripción vacía se infiere de la hoja maestra.
  const description =
    parsed.data.description ?? (await describeFromMaster(supabase, parsed.data.masterImageId));

  const { error, count } = await supabase
    .from('characters')
    .update(
      {
        name: parsed.data.name,
        description: description ?? null,
        master_image_id: parsed.data.masterImageId,
        angle_image_ids: parsed.data.angleImageIds,
        reference_image_ids: allIds,
      },
      { count: 'exact' },
    )
    .eq('id', id)
    .eq('workspace_id', workspace.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  // count 0 = id inexistente o de otro workspace: no es éxito, es not_found.
  if (!count) return { ok: false, error: 'not_found' };
  revalidatePath('/app/brand/cast');
  return { ok: true, data: { updated: true } };
}

// Sugerencia de descripción para el form (preview editable, como el brief): el
// usuario sube/genera la hoja maestra y el modelo propone la apariencia, que
// puede ajustar antes de guardar. Falla dura aquí (a diferencia del auto-relleno
// de create/update) porque el usuario la pidió explícitamente y espera respuesta.
export async function describeCharacterAction(masterImageId: unknown): Promise<Result<{ description: string }>> {
  const parsed = z.string().uuid().safeParse(masterImageId);
  if (!parsed.success) return { ok: false, error: 'validation_error' };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  if (!(await validateImageOwnership(supabase, workspace.id, [parsed.data]))) {
    return { ok: false, error: 'forbidden', message: 'Imagen no pertenece al workspace' };
  }
  const description = await describeFromMaster(supabase, parsed.data);
  if (!description) {
    return { ok: false, error: 'provider_error', message: 'No se pudo describir la imagen' };
  }
  return { ok: true, data: { description } };
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
  revalidatePath('/app/brand/cast');
  return { ok: true, data: { deleted: true } };
}
