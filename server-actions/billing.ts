'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin, requireUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { PACK_CATALOG } from '@/lib/billing/packs';

const CreatePurchaseSchema = z.object({
  packId: z.enum(['starter', 'creator', 'pro', 'studio']),
});

const ApprovePurchaseSchema = z.object({ id: z.string().uuid() });
const RejectPurchaseSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().min(3).max(500),
});

type Result<T = unknown> =
  | { ok: true; data: T }
  | {
      ok: false;
      error:
        | 'validation_error'
        | 'unauthenticated'
        | 'forbidden'
        | 'internal_error'
        | 'already_pending';
      message?: string;
    };

export async function createPurchaseAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = CreatePurchaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error' };

  const user = await requireUser();
  const pack = PACK_CATALOG[parsed.data.packId];
  const supabase = await createClient();

  // Evitar duplicados pendientes del mismo pack
  const { data: existing } = await supabase
    .from('credit_purchases')
    .select('id')
    .eq('user_id', user.id)
    .eq('pack_id', parsed.data.packId)
    .eq('status', 'pending')
    .maybeSingle();
  if (existing) {
    return { ok: false, error: 'already_pending' };
  }

  const { data, error } = await supabase
    .from('credit_purchases')
    .insert({
      user_id: user.id,
      pack_id: parsed.data.packId,
      credits: pack.credits,
      price_mxn: pack.priceMxn,
    })
    .select('id')
    .single();
  if (error || !data) {
    return { ok: false, error: 'internal_error', message: error?.message ?? 'no row' };
  }
  revalidatePath('/app/billing');
  revalidatePath('/admin/purchases');
  return { ok: true, data: { id: data.id as string } };
}

export async function approvePurchaseAction(input: unknown): Promise<Result> {
  const parsed = ApprovePurchaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error' };
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('approve_purchase', { p_purchase_id: parsed.data.id });
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/billing');
  revalidatePath('/admin/purchases');
  return { ok: true, data: {} };
}

export async function rejectPurchaseAction(input: unknown): Promise<Result> {
  const parsed = RejectPurchaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error' };
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('reject_purchase', {
    p_purchase_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/billing');
  revalidatePath('/admin/purchases');
  return { ok: true, data: {} };
}
