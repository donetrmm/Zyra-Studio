'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

const ColorSchema = z.object({
  name: z.string().trim().min(1).max(50),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const UpsertSchema = z.object({
  name: z.string().trim().min(1).max(100),
  colors: z.array(ColorSchema).max(10).optional(),
  fonts: z.array(z.string().trim().min(1).max(100)).max(5).optional(),
  logoUrl: z.string().url().optional().nullable(),
  toneDescription: z.string().trim().max(2000).optional(),
  styleGuidelines: z.string().trim().max(2000).optional(),
});

export async function listBrandKitsAction(): Promise<Result<unknown[]>> {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('brand_kits')
    .select('*')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false });
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  return { ok: true, data: data ?? [] };
}

export async function createBrandKitAction(
  input: unknown,
): Promise<Result<{ id: string }>> {
  const parsed = UpsertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('brand_kits')
    .insert({
      workspace_id: workspace.id,
      name: parsed.data.name,
      colors: parsed.data.colors ?? [],
      fonts: parsed.data.fonts ?? [],
      logo_url: parsed.data.logoUrl ?? null,
      tone_description: parsed.data.toneDescription ?? null,
      style_guidelines: parsed.data.styleGuidelines ?? null,
    })
    .select('id')
    .single();
  if (error || !data) {
    return { ok: false, error: 'internal_error', message: error?.message ?? 'insert failed' };
  }
  revalidatePath('/app/brand-kits');
  return { ok: true, data: { id: data.id as string } };
}

export async function updateBrandKitAction(
  id: string,
  input: unknown,
): Promise<Result<{ updated: true }>> {
  const parsed = UpsertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('brand_kits')
    .update({
      name: parsed.data.name,
      colors: parsed.data.colors ?? [],
      fonts: parsed.data.fonts ?? [],
      logo_url: parsed.data.logoUrl ?? null,
      tone_description: parsed.data.toneDescription ?? null,
      style_guidelines: parsed.data.styleGuidelines ?? null,
    })
    .eq('id', id);
  if (error) {
    return { ok: false, error: 'internal_error', message: error.message };
  }
  revalidatePath('/app/brand-kits');
  return { ok: true, data: { updated: true } };
}

export async function deleteBrandKitAction(
  id: string,
): Promise<Result<{ deleted: true }>> {
  await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('brand_kits')
    .delete()
    .eq('id', id);
  if (error) {
    return { ok: false, error: 'internal_error', message: error.message };
  }
  revalidatePath('/app/brand-kits');
  return { ok: true, data: { deleted: true } };
}
