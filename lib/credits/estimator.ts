import type { PricingRow } from './types';

export type { PricingRow };

export type EstimateInput = {
  provider: string;
  model: string;
  variant: string;
  params?: {
    megapixels?: number;
    references?: number;
    conversational?: boolean;
    useGrounding?: boolean;
    charCount?: number;
    durationSeconds?: number;
    passes?: number;
  };
};

export type EstimateBreakdown = {
  base: number;
  units?: number;
  unitSize?: number;
  unitLabel?: string;
  multipliers: { label: string; factor: number }[];
  bonuses: { label: string; amount: number }[];
  total: number;
};

function findRow(rows: PricingRow[], input: EstimateInput): PricingRow | null {
  return (
    rows.find(
      (r) =>
        r.provider === input.provider &&
        r.model_id === input.model &&
        r.variant === input.variant,
    ) ?? null
  );
}

function pickUnits(input: EstimateInput, row: PricingRow): number {
  if (!row.unit_size) return 1;
  if (row.provider === 'flux' && input.params?.megapixels !== undefined) {
    return Math.max(1, input.params.megapixels);
  }
  if (row.unit_label === 'chars' && input.params?.charCount !== undefined) {
    return Math.max(1, input.params.charCount);
  }
  if (row.unit_label === 'seconds' && input.params?.durationSeconds !== undefined) {
    return Math.max(1, input.params.durationSeconds);
  }
  return 1;
}

export function estimateCredits(
  rows: PricingRow[],
  input: EstimateInput,
): EstimateBreakdown {
  const row = findRow(rows, input);
  if (!row) {
    throw new Error(
      `Pricing no encontrado para ${input.provider}/${input.model}/${input.variant}`,
    );
  }

  let base = row.credits_cost;
  let units: number | undefined;
  if (row.unit_size) {
    units = pickUnits(input, row);
    base = Math.ceil(units / row.unit_size) * row.credits_cost;
  }

  const multipliers: { label: string; factor: number }[] = [];
  const bonuses: { label: string; amount: number }[] = [];

  if (input.provider === 'nano-banana') {
    if (input.params?.conversational) multipliers.push({ label: 'Edición conversacional', factor: 1.5 });
    if (input.params?.useGrounding) multipliers.push({ label: 'Grounding', factor: 1.2 });
    const passes = input.params?.passes ?? 1;
    if (passes > 1) bonuses.push({ label: `Zona segura (${passes - 1} pasada extra)`, amount: (passes - 1) * base });
  }

  if (input.provider === 'flux') {
    const refs = input.params?.references ?? 0;
    if (refs > 0) bonuses.push({ label: `${refs} referencia${refs === 1 ? '' : 's'}`, amount: refs * 15 });
  }

  let total = base;
  for (const m of multipliers) total *= m.factor;
  for (const b of bonuses) total += b.amount;
  total = Math.ceil(total);

  return {
    base,
    units,
    unitSize: row.unit_size ?? undefined,
    unitLabel: row.unit_label ?? undefined,
    multipliers,
    bonuses,
    total,
  };
}
