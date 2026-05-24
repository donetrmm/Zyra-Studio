import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { PricingRow } from './types';

export type { PricingRow } from './types';

export const loadPricing = cache(async (): Promise<PricingRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('model_pricing')
    .select('provider, model_id, variant, credits_cost, unit_size, unit_label');
  if (error) throw new Error(`No se pudo cargar model_pricing: ${error.message}`);
  return (data ?? []) as PricingRow[];
});
