// Estimador de campaña (specs/v2/03 tarea 6). Seedance cobra per-second por
// variante de resolución (migración 024); el costo se recalcula SIEMPRE
// server-side (regla de server actions).

import type { PricingRow } from '@/lib/credits/types';

export type SeedanceResolutionVariant = 'per_second_480p' | 'per_second_720p' | 'per_second_1080p';

export function seedanceVariant(resolution: '480p' | '720p' | '1080p'): SeedanceResolutionVariant {
  return `per_second_${resolution}`;
}

export function seedanceCostPerItem(
  pricing: PricingRow[],
  modelSlug: string,
  resolution: '480p' | '720p' | '1080p',
  durationS: number,
): number {
  const variant = seedanceVariant(resolution);
  const row = pricing.find(
    (p) => p.provider === 'seedance' && p.model_id === modelSlug && p.variant === variant,
  );
  if (!row) {
    throw new Error(`pricing no encontrado para seedance ${modelSlug}/${variant}`);
  }
  return Math.max(1, durationS) * Number(row.credits_cost);
}

export function estimatePlanCost(
  pricing: PricingRow[],
  items: Array<{ modelSlug: string; durationS: number }>,
  resolution: '480p' | '720p' | '1080p' = '480p',
): { perItem: number[]; total: number } {
  const perItem = items.map((it) =>
    seedanceCostPerItem(pricing, it.modelSlug, resolution, it.durationS),
  );
  return { perItem, total: perItem.reduce((a, b) => a + b, 0) };
}
