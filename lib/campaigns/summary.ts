import type { SupabaseClient } from '@supabase/supabase-js';

// Resumen de una campaña studio con su compuerta pendiente. Lo consumen la
// lista de campañas y el dashboard acción-primero (specs/v2/06 §4.2-4.3):
// el mismo verbo de compuerta aparece en ambos lugares.

export type CampaignSummary = {
  id: string;
  name: string;
  status: string;
  productName: string;
  creditsEstimated: number | null;
  createdAt: string;
  total: number;
  drafts: number;
  finals: number;
  generating: number;
  failed: number;
};

export const PIPELINE_STAGES = ['Plan', 'Muestra', 'Lote', 'Entrega'] as const;

export type CampaignGate = { stage: number; cta: string; live?: boolean };

export function deriveGate(c: CampaignSummary): CampaignGate {
  if (c.status === 'delivered' || c.status === 'archived') {
    return { stage: 3, cta: 'Descarga la entrega' };
  }
  if (c.total === 0) return { stage: 0, cta: 'Genera el plan' };
  if (c.generating > 0) {
    return { stage: c.finals > 0 || c.drafts > 0 ? 2 : 1, cta: 'Generando…', live: true };
  }
  if (c.finals === c.total) return { stage: 3, cta: 'Marca ganadores y descarga' };
  if (c.drafts > 0) return { stage: 1, cta: 'Aprueba los borradores' };
  if (c.finals > 0) return { stage: 2, cta: 'Continúa el lote' };
  return { stage: 0, cta: 'Revisa el plan y tira la muestra' };
}

// Qué tan "accionable" es una campaña: decide quién gana el hero del
// dashboard. Una compuerta esperando al usuario pesa más que un lote
// generando solo (criterio del brief §9.4; desempate: la más reciente).
export function gateUrgency(c: CampaignSummary): number {
  const gate = deriveGate(c);
  if (gate.live) return 1;
  if (c.status === 'delivered' || c.status === 'archived') return 0;
  if (c.drafts > 0) return 4;
  if (c.total === 0 || c.finals === 0) return 3;
  if (c.finals === c.total) return 2;
  return 3;
}

// Campañas studio del workspace con stats de items agregadas.
// `supabase` es el client de sesión (RLS aplica).
export async function fetchCampaignSummaries(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<CampaignSummary[]> {
  const { data: campaignRows } = await supabase
    .from('campaigns')
    .select('id, name, status, product_brief, credits_estimated, created_at')
    .eq('workspace_id', workspaceId)
    .not('product_brief', 'is', null)
    .order('created_at', { ascending: false });

  const ids = (campaignRows ?? []).map((c) => c.id as string);
  const { data: itemRows } = ids.length
    ? await supabase.from('campaign_items').select('campaign_id, status').in('campaign_id', ids)
    : { data: [] as { campaign_id: string; status: string }[] };

  const statsByCampaign = new Map<
    string,
    { total: number; drafts: number; finals: number; generating: number; failed: number }
  >();
  for (const row of itemRows ?? []) {
    const cid = row.campaign_id as string;
    const stats =
      statsByCampaign.get(cid) ?? { total: 0, drafts: 0, finals: 0, generating: 0, failed: 0 };
    stats.total += 1;
    const s = row.status as string;
    if (s === 'draft_ready') stats.drafts += 1;
    else if (s === 'final_ready') stats.finals += 1;
    else if (s === 'sample' || s === 'queued' || s === 'approved') stats.generating += 1;
    else if (s === 'failed') stats.failed += 1;
    statsByCampaign.set(cid, stats);
  }

  return (campaignRows ?? []).map((c) => {
    const brief = (c.product_brief ?? {}) as { productName?: string };
    const stats = statsByCampaign.get(c.id as string) ?? {
      total: 0,
      drafts: 0,
      finals: 0,
      generating: 0,
      failed: 0,
    };
    return {
      id: c.id as string,
      name: c.name as string,
      status: (c.status as string) ?? 'draft',
      productName: brief.productName ?? '',
      creditsEstimated: (c.credits_estimated as number | null) ?? null,
      createdAt: c.created_at as string,
      ...stats,
    };
  });
}
