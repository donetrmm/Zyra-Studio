import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

// reserve_credits / confirm_credits / refund_credits están revoked de
// authenticated (ver migration 006). Solo service_role las puede invocar.
// SIEMPRE pasar el userId validado contra la sesión, nunca uno del cliente.

export async function reserveCredits(
  userId: string,
  amount: number,
  generationId: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('reserve_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_generation_id: generationId,
  });
  if (error) throw new Error(`reserve_credits: ${error.message}`);
  return data === true;
}

export async function confirmCredits(
  userId: string,
  amount: number,
  generationId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc('confirm_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_generation_id: generationId,
  });
  if (error) throw new Error(`confirm_credits: ${error.message}`);
}

export async function refundCredits(
  userId: string,
  amount: number,
  generationId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc('refund_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_generation_id: generationId,
  });
  if (error) throw new Error(`refund_credits: ${error.message}`);
}
