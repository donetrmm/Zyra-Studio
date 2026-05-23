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

// Cargos directos (sin generation_id) para operaciones internas como
// prompt_enhance. Atómico: si el balance es insuficiente devuelve false y NO
// descuenta. Pareado con refund_charge cuando el proveedor externo falla
// después del cargo.
export async function chargeCredits(
  userId: string,
  amount: number,
  reason: string,
  metadata?: Record<string, unknown>,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('charge_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_metadata: metadata ?? null,
  });
  if (error) throw new Error(`charge_credits: ${error.message}`);
  return data === true;
}

export async function refundCharge(
  userId: string,
  amount: number,
  reason: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc('refund_charge', {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_metadata: metadata ?? null,
  });
  if (error) throw new Error(`refund_charge: ${error.message}`);
}
