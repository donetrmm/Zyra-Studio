export type PricingRow = {
  provider: string;
  model_id: string;
  variant: string;
  credits_cost: number;
  unit_size: number | null;
  unit_label: string | null;
};
