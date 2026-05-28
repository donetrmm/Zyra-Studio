'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { cloneVoice, deleteVoice, getVoicePreview, tts } from '@/lib/providers/elevenlabs';
import { OFFICIAL_VOICE_IDS } from '@/lib/elevenlabs/official-voices';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

// Cache module-level del preview_url por voiceId. Sobrevive entre invocaciones
// que reusan la instancia (Fluid Compute). Si la instancia se mata, otra
// invocación refresca; cuesta una sola llamada a ElevenLabs.
const previewCache = new Map<string, { url: string | null; expiresAt: number }>();
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

const CloneSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
});

export async function cloneVoiceAction(
  formData: FormData,
): Promise<Result<{ id: string }>> {
  const { user, workspace } = await requireWorkspace();

  const parsed = CloneSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }

  const files: { buffer: Buffer; filename: string }[] = [];
  for (const entry of formData.getAll('files')) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    const arrayBuf = await entry.arrayBuffer();
    files.push({ buffer: Buffer.from(arrayBuf), filename: entry.name });
  }
  if (files.length === 0) {
    return { ok: false, error: 'validation_error', message: 'Sube al menos un archivo de audio' };
  }

  const supabase = await createClient();

  try {
    const { voiceId } = await cloneVoice({
      name: parsed.data.name,
      description: parsed.data.description,
      files,
    });

    const { data: row, error } = await supabase
      .from('voice_clones')
      .insert({
        user_id: user.id,
        workspace_id: workspace.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        elevenlabs_voice_id: voiceId,
        status: 'ready',
      })
      .select('id')
      .single();

    if (error || !row) {
      await deleteVoice(voiceId).catch(() => {});
      return { ok: false, error: 'internal_error', message: error?.message ?? 'insert failed' };
    }

    revalidatePath('/app/voices');
    return { ok: true, data: { id: row.id as string } };
  } catch (err) {
    return { ok: false, error: 'provider_error', message: (err as Error).message };
  }
}

export async function deleteVoiceAction(
  voiceCloneId: string,
): Promise<Result<{ deleted: true }>> {
  const { user } = await requireWorkspace();
  const supabase = await createClient();

  const { data: row } = await supabase
    .from('voice_clones')
    .select('elevenlabs_voice_id')
    .eq('id', voiceCloneId)
    .eq('user_id', user.id)
    .single();

  if (!row) {
    return { ok: false, error: 'not_found', message: 'Voz no encontrada' };
  }

  if (row.elevenlabs_voice_id) {
    try {
      await deleteVoice(row.elevenlabs_voice_id);
    } catch {
      // Best-effort
    }
  }

  const { error } = await supabase
    .from('voice_clones')
    .delete()
    .eq('id', voiceCloneId)
    .eq('user_id', user.id);

  if (error) {
    return { ok: false, error: 'internal_error', message: error.message };
  }

  revalidatePath('/app/voices');
  return { ok: true, data: { deleted: true } };
}

export async function getVoicePreviewAction(
  voiceId: string,
): Promise<Result<{ previewUrl: string | null }>> {
  const { user } = await requireWorkspace();
  if (!/^[A-Za-z0-9_-]+$/.test(voiceId) || voiceId.length > 64) {
    return { ok: false, error: 'validation_error', message: 'voiceId inválido' };
  }

  // El voiceId debe pertenecer al catálogo oficial o ser una voz clonada del
  // user. Evita que se use esta acción como proxy genérico contra ElevenLabs
  // o para enumerar previews de clones ajenos.
  const isOfficial = OFFICIAL_VOICE_IDS.has(voiceId);
  if (!isOfficial) {
    const supabase = await createClient();
    const { data: owned } = await supabase
      .from('voice_clones')
      .select('id')
      .eq('elevenlabs_voice_id', voiceId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!owned) {
      return { ok: false, error: 'not_found', message: 'Voz no encontrada' };
    }
  }

  // Las URLs de preview son las mismas para todos (CDN pública de ElevenLabs),
  // así que el cache se puede compartir entre usuarios sin riesgo de leak.
  const cached = previewCache.get(voiceId);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true, data: { previewUrl: cached.url } };
  }

  try {
    const { previewUrl } = await getVoicePreview(voiceId);
    previewCache.set(voiceId, { url: previewUrl, expiresAt: Date.now() + PREVIEW_TTL_MS });
    return { ok: true, data: { previewUrl } };
  } catch (err) {
    return { ok: false, error: 'provider_error', message: (err as Error).message };
  }
}

export async function tryVoiceAction(params: {
  voiceId: string;
  text: string;
}): Promise<Result<{ audioBase64: string }>> {
  const { user } = await requireWorkspace();
  const supabase = await createClient();

  const { data: voice } = await supabase
    .from('voice_clones')
    .select('id')
    .eq('elevenlabs_voice_id', params.voiceId)
    .eq('user_id', user.id)
    .single();
  if (!voice) {
    return { ok: false, error: 'forbidden', message: 'Voz no encontrada' };
  }

  if (!params.text.trim() || params.text.length > 500) {
    return { ok: false, error: 'validation_error', message: 'Texto entre 1 y 500 caracteres' };
  }

  try {
    const buffer = await tts({
      text: params.text,
      voiceId: params.voiceId,
      modelId: 'eleven_flash_v2_5',
    });
    return { ok: true, data: { audioBase64: buffer.toString('base64') } };
  } catch (err) {
    return { ok: false, error: 'provider_error', message: (err as Error).message };
  }
}
