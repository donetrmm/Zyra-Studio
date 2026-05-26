'use server';

import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/dal';
import { chargeCredits, refundCharge } from '@/lib/credits/operations';
import { loadPricing } from '@/lib/credits/pricing';
import { enhancePrompt, type EnhanceHint, type EnhanceType } from '@/lib/providers/prompt-enhancer';
import { ProviderError } from '@/lib/providers/types';

const InputSchema = z.object({
  prompt: z.string().trim().min(3, 'prompt muy corto').max(20000),
  hint: z.enum(['photoreal', 'illustration', 'text-in-image']).optional(),
  type: z.enum(['image', 'video', 'audio']).optional(),
});

type ActionError =
  | 'validation_error'
  | 'unauthenticated'
  | 'insufficient_credits'
  | 'safety'
  | 'provider_error'
  | 'internal_error';

export type EnhanceResult =
  | { ok: true; enhanced: string; cost: number }
  | { ok: false; error: ActionError; message?: string };

// Costo cargado desde model_pricing (provider='internal', model='prompt-enhance').
// Fallback a 5 si la row no existe aún (migration no aplicada).
async function loadEnhanceCost(): Promise<number> {
  const pricing = await loadPricing();
  const row = pricing.find(
    (p) => p.provider === 'internal' && p.model_id === 'prompt-enhance',
  );
  return row?.credits_cost ?? 5;
}

export async function enhancePromptAction(input: unknown): Promise<EnhanceResult> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }

  const user = await requireUser();
  const cost = await loadEnhanceCost();

  // Cargo atómico antes de invocar al proveedor: si falla, no le cobramos.
  // Si Gemini falla después, refundimos.
  const source = `${parsed.data.type ?? 'image'}_create`;
  const charged = await chargeCredits(user.id, cost, 'prompt_enhance', {
    source,
  });
  if (!charged) {
    return { ok: false, error: 'insufficient_credits' };
  }

  try {
    const enhanced = await enhancePrompt({
      prompt: parsed.data.prompt,
      hint: parsed.data.hint as EnhanceHint | undefined,
      type: parsed.data.type as EnhanceType | undefined,
    });
    return { ok: true, enhanced, cost };
  } catch (err) {
    await refundCharge(user.id, cost, 'prompt_enhance_refund', {
      source,
    }).catch(() => {});
    if (err instanceof ProviderError && err.code === 'safety') {
      return { ok: false, error: 'safety', message: err.message };
    }
    const message = err instanceof ProviderError ? err.message : (err as Error).message;
    return { ok: false, error: 'provider_error', message };
  }
}
