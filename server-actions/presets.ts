'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

const SavePresetSchema = z.object({
  type: z.enum(['image', 'video', 'audio']),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  params: z.record(z.string(), z.unknown()),
  isPublic: z.boolean().default(false),
});

export async function savePresetAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = SavePresetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('presets')
    .insert({
      user_id: user.id,
      type: parsed.data.type,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      params: parsed.data.params,
      is_public: parsed.data.isPublic,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'internal_error', message: error?.message };
  revalidatePath('/app/create/presets');
  return { ok: true, data: { id: data.id as string } };
}

export async function deletePresetAction(id: string): Promise<Result<{ deleted: true }>> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('presets')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/create/presets');
  return { ok: true, data: { deleted: true } };
}

export async function usePresetAction(id: string): Promise<Result<{ params: Record<string, unknown>; type: string }>> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('presets')
    .select('type, params, uses_count')
    .eq('id', id)
    .single();
  if (error || !data) return { ok: false, error: 'not_found' };
  await supabase.from('presets').update({ uses_count: ((data.uses_count as number) ?? 0) + 1 }).eq('id', id);
  return { ok: true, data: { params: data.params as Record<string, unknown>, type: data.type as string } };
}
