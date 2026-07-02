import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

// reserve_credits / confirm_credits / refund_credits están revoked de
// authenticated (ver migration 006). Solo service_role las puede invocar.
// SIEMPRE pasar el userId validado contra la sesión, nunca uno del cliente.

export type CompleteGenerationInput = {
  userId: string;
  generationId: string;
  cost: number;
  outputUrl: string;
  thumbnailUrl: string | null;
  processingMs: number;
  fileSizeBytes: number;
  providerPayload?: Record<string, unknown> | null;
};

// Reintentos SOLO ante statement timeout: el RPC es idempotente (migración 037,
// guard por credits_charged + status terminal), así que repetirlo es seguro. Sin
// esto, un apuro transitorio de la instancia tira un output ya pagado al
// proveedor (fail + refund) por un timeout de milisegundos de mala suerte.
const COMPLETE_RETRY_DELAYS_MS = [1000, 2500];

// Atómica: status='done' + decremento de pending + credits_charged en una sola
// transacción. Idempotente — si la generación ya fue confirmada, no-op.
export async function completeGeneration(input: CompleteGenerationInput): Promise<void> {
  const admin = createAdminClient();
  let lastError = 'unknown';
  for (let attempt = 0; attempt <= COMPLETE_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, COMPLETE_RETRY_DELAYS_MS[attempt - 1]));
    }
    const { error } = await admin.rpc('complete_generation', {
      p_user_id: input.userId,
      p_generation_id: input.generationId,
      p_cost: input.cost,
      p_output_url: input.outputUrl,
      p_thumbnail_url: input.thumbnailUrl,
      p_processing_ms: input.processingMs,
      p_file_size_bytes: input.fileSizeBytes,
      p_provider_payload: input.providerPayload ?? null,
    });
    if (!error) return;
    lastError = error.message;
    if (!error.message.includes('statement timeout')) break;
    console.error('[credits] complete_generation timeout; reintentando', {
      generationId: input.generationId,
      attempt: attempt + 1,
    });
  }
  throw new Error(`complete_generation: ${lastError}`);
}

// Atómica: status='failed' + refund SOLO si no fue confirmada todavía
// (idempotente — si ya estaba en estado terminal, no-op).
export async function failGeneration(
  userId: string,
  generationId: string,
  cost: number,
  errorMessage: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc('fail_generation', {
    p_user_id: userId,
    p_generation_id: generationId,
    p_cost: cost,
    p_error_message: errorMessage,
  });
  if (error) throw new Error(`fail_generation: ${error.message}`);
}

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
