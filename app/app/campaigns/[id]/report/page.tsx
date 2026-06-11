import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { buildValueReport, CREDIT_USD_RATE, type RateRow } from '@/lib/campaigns/report';

export const dynamic = 'force-dynamic';

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const usdFine = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

export default async function CampaignReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, name, workspace_id, product_brief')
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .single();
  if (!campaign) redirect('/app/campaigns');

  const [{ data: itemRows }, { data: formatRows }, { data: rateRows }, { data: genRows }] =
    await Promise.all([
      supabase
        .from('campaign_items')
        .select('format_id, status')
        .eq('campaign_id', id)
        .eq('status', 'final_ready'),
      supabase.from('formats').select('id, slug'),
      supabase
        .from('value_rate_card')
        .select('asset_type, label, low_usd, mid_usd, high_usd')
        .eq('active', true),
      supabase
        .from('generations')
        .select('credits_charged, processing_ms, status')
        .eq('campaign_id', id),
    ]);

  const formatSlugs = new Map((formatRows ?? []).map((f) => [f.id as string, f.slug as string]));
  const finalsByType = new Map<string, number>();
  for (const item of itemRows ?? []) {
    const slug = item.format_id ? formatSlugs.get(item.format_id as string) : undefined;
    if (!slug) continue;
    finalsByType.set(slug, (finalsByType.get(slug) ?? 0) + 1);
  }

  const creditsCharged = (genRows ?? []).reduce(
    (sum, g) => sum + (g.status === 'done' ? Number(g.credits_charged ?? 0) : 0),
    0,
  );
  const renderMs = (genRows ?? []).reduce((sum, g) => sum + Number(g.processing_ms ?? 0), 0);

  const report = buildValueReport({
    finalsByType,
    rateCard: (rateRows ?? []) as RateRow[],
    creditsCharged,
    renderMs,
  });

  const brief = (campaign.product_brief ?? {}) as { productName?: string };
  const maxBar = Math.max(report.traditional.high, report.spentUsd, 1);
  const bar = (value: number) => `${Math.max(1, Math.round((value / maxBar) * 100))}%`;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/app/campaigns/${id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {campaign.name as string}
      </Link>

      <h1 className="text-[18px] font-semibold text-foreground">Reporte de valor</h1>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">
        {brief.productName ?? 'Campaña'} · {report.totalFinals} creativos finales
      </p>

      {report.totalFinals === 0 ? (
        <div className="mt-12 rounded-xl border border-border bg-card/50 p-8 text-center">
          <p className="text-[14px] text-foreground/70">Aún no hay creativos finales</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            El reporte compara el costo real contra producción tradicional cuando apruebes renders finales.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 rounded-2xl border border-primary/30 bg-primary/5 p-6">
            <p className="text-[13px] text-muted-foreground">
              {report.totalFinals} creativos finales entregados por
            </p>
            <p className="mt-1 text-[28px] font-semibold tracking-tight text-foreground">
              {usdFine(report.spentUsd)}
              <span className="ml-2 text-[14px] font-normal text-muted-foreground">
                ({new Intl.NumberFormat('es-MX').format(report.creditsCharged)} créditos)
              </span>
            </p>
            <p className="mt-2 text-[13px] text-muted-foreground">
              En producción tradicional: {usd(report.traditional.low)} – {usd(report.traditional.high)}.
              Ahorro de <span className="font-medium text-foreground">{report.savingsPctMid.toFixed(1)}%</span> sobre
              el escenario medio y{' '}
              <span className="font-medium text-foreground">
                {report.traditionalWeeks} semana{report.traditionalWeeks !== 1 ? 's' : ''}
              </span>{' '}
              de producción ({report.renderHours < 1 ? '<1' : report.renderHours.toFixed(1)} h de render real).
            </p>
          </div>

          <div className="mt-6 space-y-2.5">
            <Bar label="1to1 Studio (real)" value={report.spentUsd} width={bar(report.spentUsd)} accent />
            <Bar label="Tradicional · low" value={report.traditional.low} width={bar(report.traditional.low)} />
            <Bar label="Tradicional · mid" value={report.traditional.mid} width={bar(report.traditional.mid)} />
            <Bar label="Tradicional · high" value={report.traditional.high} width={bar(report.traditional.high)} />
          </div>

          <div className="mt-8 overflow-hidden rounded-xl border border-border">
            <table className="w-full text-left text-[12.5px]">
              <thead className="border-b border-border bg-muted/20 text-[11px] uppercase tracking-wide text-muted-foreground/60">
                <tr>
                  <th className="px-3 py-2 font-medium">Tipo de activo</th>
                  <th className="px-3 py-2 text-right font-medium">Finales</th>
                  <th className="px-3 py-2 text-right font-medium">Low</th>
                  <th className="px-3 py-2 text-right font-medium">Mid</th>
                  <th className="px-3 py-2 text-right font-medium">High</th>
                </tr>
              </thead>
              <tbody>
                {report.lines.map((line) => (
                  <tr key={line.assetType} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2 text-foreground/90">{line.label}</td>
                    <td className="px-3 py-2 text-right font-mono">{line.count}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{usd(line.low)}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{usd(line.mid)}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{usd(line.high)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground/50">
            Metodología: los costos tradicionales son estimaciones de rangos de producción por tipo de
            activo (rate card editable en el panel admin), no cotizaciones. El gasto real suma los créditos
            confirmados de la campaña a {usdFine(CREDIT_USD_RATE)}/crédito. El tiempo tradicional estima 1
            semana de preproducción más media semana por activo con producción solapada. Los precios varían
            por región y agencia.
          </p>
        </>
      )}
    </div>
  );
}

function Bar({
  label,
  value,
  width,
  accent,
}: {
  label: string;
  value: number;
  width: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[11.5px]">
        <span className={accent ? 'font-medium text-foreground' : 'text-muted-foreground'}>{label}</span>
        <span className="font-mono text-muted-foreground">{usdFine(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted/30">
        <div
          className={`h-full rounded-full ${accent ? 'bg-primary' : 'bg-muted-foreground/30'}`}
          style={{ width }}
        />
      </div>
    </div>
  );
}
