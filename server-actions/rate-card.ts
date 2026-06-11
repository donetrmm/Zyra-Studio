'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

const UpdateRowSchema = z
  .object({
    id: z.string().uuid(),
    lowUsd: z.number().min(0),
    midUsd: z.number().min(0),
    highUsd: z.number().min(0),
    active: z.boolean(),
  })
  .refine((v) => v.lowUsd <= v.midUsd && v.midUsd <= v.highUsd, {
    message: 'low ≤ mid ≤ high',
  });

// Rate card del reporte de valor: solo admin (RLS también lo exige).
export async function updateRateCardRowAction(input: unknown): Promise<Result<{ updated: true }>> {
  const parsed = UpdateRowSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('value_rate_card')
    .update({
      low_usd: parsed.data.lowUsd,
      mid_usd: parsed.data.midUsd,
      high_usd: parsed.data.highUsd,
      active: parsed.data.active,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/admin/rate-card');
  return { ok: true, data: { updated: true } };
}
