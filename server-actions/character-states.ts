'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import { CreateCharacterStateSchema, UpdateCharacterStateImageSchema } from '@/lib/schemas/character-states';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

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
): Promise<
  Result<
    Array<{
      id: string;
      label: string;
      stateImageId: string | null;
      description: string | null;
      previewUrl: string | null;
    }>
  >
> {
  if (typeof characterId !== 'string') return { ok: false, error: 'validation_error' };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data } = await supabase
    .from('character_states')
    .select('id, label, state_image_id, description')
    .eq('character_id', characterId)
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: true });
  const states = (data ?? []).map((r) => ({
    id: r.id as string,
    label: r.label as string,
    stateImageId: (r.state_image_id as string | null) ?? null,
    description: (r.description as string | null) ?? null,
  }));
  // Resuelve la URL firmada de cada imagen de estado para poder mostrar la
  // miniatura (las imagenes son media_references; el server component padre solo
  // firma master + angulos, no los estados que se cargan aqui).
  const imageIds = [...new Set(states.map((s) => s.stateImageId).filter((id): id is string => !!id))];
  const previews: Record<string, string> = {};
  if (imageIds.length) {
    const { data: refs } = await supabase
      .from('media_references')
      .select('id, storage_url')
      .in('id', imageIds);
    await Promise.all(
      (refs ?? []).map(async (r) => {
        if (!r.storage_url) return;
        try {
          previews[r.id as string] = await signedReferenceUrl(r.storage_url as string);
        } catch {
          // sin preview
        }
      }),
    );
  }
  return {
    ok: true,
    data: states.map((s) => ({
      ...s,
      previewUrl: s.stateImageId ? previews[s.stateImageId] ?? null : null,
    })),
  };
}

// Refinado de estado (P05): apunta el estado a una nueva imagen ya generada
// (re-editada con Nano Banana). Valida ownership del estado y de la imagen, y
// devuelve la URL firmada de la nueva imagen para refrescar la miniatura.
export async function updateCharacterStateImageAction(
  input: unknown,
): Promise<Result<{ id: string; previewUrl: string | null }>> {
  const parsed = UpdateCharacterStateImageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data: st } = await supabase
    .from('character_states').select('id, workspace_id').eq('id', parsed.data.stateId).single();
  if (!st || st.workspace_id !== workspace.id) return { ok: false, error: 'not_found', message: 'Estado no encontrado' };
  if (!(await ownsImage(supabase, workspace.id, parsed.data.stateImageId))) {
    return { ok: false, error: 'forbidden', message: 'Imagen no pertenece al workspace' };
  }
  const { error } = await supabase
    .from('character_states')
    .update({ state_image_id: parsed.data.stateImageId })
    .eq('id', parsed.data.stateId)
    .eq('workspace_id', workspace.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  let previewUrl: string | null = null;
  const { data: ref } = await supabase
    .from('media_references').select('storage_url').eq('id', parsed.data.stateImageId).single();
  if (ref?.storage_url) {
    try {
      previewUrl = await signedReferenceUrl(ref.storage_url as string);
    } catch {
      // sin preview
    }
  }
  revalidatePath('/app/brand/cast');
  return { ok: true, data: { id: parsed.data.stateId, previewUrl } };
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
