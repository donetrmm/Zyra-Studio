import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/admin';
import { RateCardTable, type RateCardRow } from '@/components/admin/RateCardTable';

export const metadata: Metadata = {
  title: 'Rate card',
};

export default async function AdminRateCardPage() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('value_rate_card')
    .select('id, asset_type, label, low_usd, mid_usd, high_usd, active')
    .order('mid_usd');

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-[22px] font-semibold tracking-tight">Rate card</h1>
        <p className="text-[13px] text-muted-foreground">
          Costo estimado de producción tradicional por tipo de activo (rango low-mid-high, USD). Alimenta
          el reporte de valor de las campañas. Son estimaciones editables, no cotizaciones.
        </p>
      </header>
      <RateCardTable rows={(data ?? []) as RateCardRow[]} />
    </div>
  );
}
