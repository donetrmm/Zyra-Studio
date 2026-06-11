'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarDays,
  Clapperboard,
  Download,
  FileBarChart,
  Loader2,
  Pencil,
  Play,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import {
  addCampaignItemAction,
  approveBatchAction,
  createVariantAction,
  deleteCampaignItemAction,
  distillTemplateAction,
  exportCampaignCsvAction,
  generateSeriesAction,
  redoSamplesAction,
  requestFinalAction,
  toggleWinnerAction,
  updateCampaignItemAction,
} from '@/server-actions/campaigns';
import { CalendarView, ImagePackCard } from './CampaignCalendar';
import { insufficientCreditsToast } from './credits-toast';

export type StudioItem = {
  id: string;
  formatId: string | null;
  formatName: string;
  templateId: string | null;
  durationS: number | null;
  aspectRatio: string | null;
  scene: string | null;
  scenePrompt: string;
  caption: string | null;
  characterName: string | null;
  scheduledDate: string | null;
  status: string;
  warnings: string[];
  generationId: string | null;
  isWinner: boolean;
};

export type StudioTemplate = {
  id: string;
  name: string;
  formatName: string;
  usesCount: number;
};

export type StudioCharacterOption = { id: string; name: string };

export type StudioCampaign = {
  id: string;
  name: string;
  status: string;
  goal: string | null;
  productName: string;
  category: string;
  creditsEstimated: number | null;
};

const STATUS_LABEL: Record<string, { label: string; tone: string; live?: boolean }> = {
  planned: { label: 'planificado', tone: 'text-muted-foreground/70 border-border' },
  sample: { label: 'muestra…', tone: 'text-sky-400/90 border-sky-400/30', live: true },
  queued: { label: 'generando…', tone: 'text-sky-400/90 border-sky-400/30', live: true },
  draft_ready: { label: 'draft listo', tone: 'text-emerald-400/90 border-emerald-400/30' },
  approved: { label: 'render final…', tone: 'text-sky-400/90 border-sky-400/30', live: true },
  final_ready: { label: 'final listo', tone: 'text-sky-300 border-sky-300/40' },
  failed: { label: 'falló', tone: 'text-red-400/90 border-red-400/30' },
  skipped: { label: 'bloqueado', tone: 'text-amber-400/90 border-amber-400/30' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? STATUS_LABEL.planned;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] ${s.tone}`}>
      {s.live && <Loader2 className="size-2.5 animate-spin" aria-hidden />}
      {s.label}
    </span>
  );
}

export type StudioFormatOption = { id: string; name: string };

export function CampaignStudioView({
  campaign,
  initialItems,
  templates,
  characterOptions,
  formatOptions,
}: {
  campaign: StudioCampaign;
  initialItems: StudioItem[];
  templates: StudioTemplate[];
  characterOptions: StudioCharacterOption[];
  formatOptions: StudioFormatOption[];
}) {
  const [items, setItems] = useState(initialItems);
  const [tab, setTab] = useState<'plan' | 'produccion' | 'plantillas' | 'calendario'>('plan');
  const [editing, setEditing] = useState<StudioItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    const res = await exportCampaignCsvAction(campaign.id);
    setExporting(false);
    if (!res.ok) {
      toast.error('No se pudo exportar');
      return;
    }
    const blob = new Blob([res.data.csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.data.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Realtime: progreso de producción sin polling (patrón del repo con setAuth).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`campaign-items:${campaign.id}`).on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'campaign_items', filter: `campaign_id=eq.${campaign.id}` },
      (payload) => {
        const r = payload.new as { id: string; status: string; warnings?: string[]; generation_id?: string | null };
        setItems((prev) =>
          prev.map((it) =>
            it.id === r.id
              ? {
                  ...it,
                  status: r.status,
                  warnings: (r.warnings as string[]) ?? it.warnings,
                  generationId: r.generation_id ?? it.generationId,
                }
              : it,
          ),
        );
      },
    );
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe();
    });
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }
    });
    return () => {
      authSub.subscription.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [campaign.id]);

  const byFormat = useMemo(() => {
    const map = new Map<string, { formatId: string; formatName: string; items: StudioItem[] }>();
    for (const item of items) {
      const key = item.formatId ?? 'sin-formato';
      const entry = map.get(key) ?? { formatId: item.formatId ?? '', formatName: item.formatName, items: [] };
      entry.items.push(item);
      map.set(key, entry);
    }
    return [...map.values()];
  }, [items]);

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/app/campaigns"
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Campañas
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">{campaign.name}</h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {campaign.productName} · {items.length} creativos
            {campaign.creditsEstimated ? ` · ~${campaign.creditsEstimated} cr (draft)` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {exporting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
            CSV
          </button>
          <Link
            href={`/app/campaigns/${campaign.id}/report`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <FileBarChart className="size-3.5" aria-hidden />
            Reporte
          </Link>
          <div className="flex gap-1 rounded-lg border border-border bg-card p-0.5">
            {(['plan', 'produccion', 'plantillas', 'calendario'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1.5 text-[12.5px] transition-colors ${
                  tab === t ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t === 'plan'
                  ? 'Plan'
                  : t === 'produccion'
                    ? 'Producción'
                    : t === 'plantillas'
                      ? `Plantillas (${templates.length})`
                      : 'Calendario'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'plan' ? (
        <>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Pencil className="size-3.5" aria-hidden />
              Agregar creativo
            </button>
          </div>
          <PlanTable items={items} onEdit={setEditing} onDeleted={(id) => setItems((p) => p.filter((i) => i.id !== id))} />
        </>
      ) : tab === 'produccion' ? (
        <ProductionView
          campaignId={campaign.id}
          groups={byFormat}
          characterOptions={characterOptions}
          onWinner={(id, isWinner) =>
            setItems((prev) => prev.map((i) => (i.id === id ? { ...i, isWinner } : i)))
          }
          onSamplesReset={(formatId) =>
            setItems((prev) =>
              prev.map((i) =>
                i.formatId === formatId && i.status === 'draft_ready'
                  ? { ...i, status: 'planned', generationId: null }
                  : i,
              ),
            )
          }
        />
      ) : tab === 'plantillas' ? (
        <TemplatesView templates={templates} />
      ) : (
        <CalendarView
          items={items}
          onReschedule={(itemId, date) =>
            setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, scheduledDate: date } : i)))
          }
        />
      )}

      {editing && (
        <EditItemDialog
          item={editing}
          characterOptions={characterOptions}
          onClose={() => setEditing(null)}
          onSaved={(patch) => {
            setItems((prev) => prev.map((i) => (i.id === editing.id ? { ...i, ...patch, status: 'planned' } : i)));
            setEditing(null);
          }}
        />
      )}

      {adding && (
        <AddItemDialog
          campaignId={campaign.id}
          formatOptions={formatOptions}
          characterOptions={characterOptions}
          onClose={() => setAdding(false)}
          onAdded={(item) => {
            setItems((prev) => [...prev, item]);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function PlanTable({
  items,
  onEdit,
  onDeleted,
}: {
  items: StudioItem[];
  onEdit: (item: StudioItem) => void;
  onDeleted: (id: string) => void;
}) {
  const editable = (s: string) => ['planned', 'skipped', 'failed'].includes(s);

  async function handleDelete(item: StudioItem) {
    const res = await deleteCampaignItemAction(item.id);
    if (!res.ok) {
      toast.error('No se pudo eliminar');
      return;
    }
    onDeleted(item.id);
  }

  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-border">
      <table className="w-full text-left text-[12.5px]">
        <thead className="border-b border-border bg-muted/20 text-[11px] uppercase tracking-wide text-muted-foreground/60">
          <tr>
            <th className="px-3 py-2 font-medium">Fecha</th>
            <th className="px-3 py-2 font-medium">Formato</th>
            <th className="hidden px-3 py-2 font-medium md:table-cell">Escena / acción</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-border/50 last:border-0">
              <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-3 text-muted-foreground/40" aria-hidden />
                  {item.scheduledDate
                    ? new Date(`${item.scheduledDate}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
                    : '—'}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-foreground/90">
                {item.formatName}
                {item.templateId && (
                  <span className="ml-1.5 rounded-full border border-primary/40 px-1.5 py-0.5 text-[10px] text-primary">
                    serie
                  </span>
                )}
                {item.characterName && (
                  <span className="ml-1.5 text-[11px] text-muted-foreground/60">· {item.characterName}</span>
                )}
              </td>
              <td className="hidden max-w-md px-3 py-2.5 md:table-cell">
                {item.scene && (
                  <p className="line-clamp-1 text-[11px] text-muted-foreground/50">{item.scene}</p>
                )}
                <p className="line-clamp-2 text-muted-foreground/80">{item.scenePrompt}</p>
                {item.caption && (
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground/50">
                    Caption: {item.caption}
                  </p>
                )}
                {item.warnings.length > 0 && (
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-amber-400/70">{item.warnings[0]}</p>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5">
                <StatusBadge status={item.status} />
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right">
                {editable(item.status) && (
                  <span className="inline-flex gap-1">
                    <button
                      type="button"
                      onClick={() => onEdit(item)}
                      aria-label="Editar item"
                      className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item)}
                      aria-label="Eliminar item"
                      className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-red-400"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductionView({
  campaignId,
  groups,
  characterOptions,
  onWinner,
  onSamplesReset,
}: {
  campaignId: string;
  groups: Array<{ formatId: string; formatName: string; items: StudioItem[] }>;
  characterOptions: StudioCharacterOption[];
  onWinner: (itemId: string, isWinner: boolean) => void;
  onSamplesReset: (formatId: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [distilling, setDistilling] = useState<StudioItem | null>(null);
  const [varianting, setVarianting] = useState<StudioItem | null>(null);

  async function handleWinner(item: StudioItem) {
    setBusy(`winner:${item.id}`);
    const res = await toggleWinnerAction(item.id);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo marcar el ganador');
      return;
    }
    onWinner(item.id, res.data.isWinner);
    toast.success(
      res.data.isWinner
        ? 'Ganador marcado: el mix de tus próximas campañas prioriza este formato'
        : 'Ganador desmarcado',
    );
  }

  async function handleBatch(formatId: string, mode: 'sample' | 'full') {
    setBusy(`${formatId}:${mode}`);
    const res = await approveBatchAction({ campaignId, formatId, mode });
    setBusy(null);
    if (!res.ok) {
      if (res.error === 'insufficient_credits') insufficientCreditsToast('Créditos insuficientes para el lote');
      else toast.error(res.message ?? 'No se pudo encolar');
      return;
    }
    toast.success(
      `${res.data.enqueued} en cola · ${res.data.creditsReserved} cr reservados${
        res.data.skipped ? ` · ${res.data.skipped} omitidos` : ''
      }`,
    );
  }

  async function handleFinal(itemId: string) {
    setBusy(`final:${itemId}`);
    const res = await requestFinalAction({ itemId });
    setBusy(null);
    if (!res.ok) {
      if (res.error === 'insufficient_credits') insufficientCreditsToast();
      else toast.error(res.message ?? 'No se pudo encolar el final');
      return;
    }
    toast.success('Render final en cola (720p, mismo seed)');
  }

  async function handleRedoSamples(formatId: string) {
    setBusy(`${formatId}:redo`);
    const res = await redoSamplesAction(campaignId, formatId);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo rehacer la muestra');
      return;
    }
    onSamplesReset(formatId);
    toast.success(
      `${res.data.reset} drafts regresaron al plan: edítalos o vuelve a tirar la muestra (cobra créditos de nuevo)`,
    );
  }

  return (
    <div className="mt-5 space-y-4">
      {groups.map((group) => {
        const pending = group.items.filter((i) => ['planned', 'failed'].includes(i.status)).length;
        const generating = group.items.filter((i) => ['sample', 'queued', 'approved'].includes(i.status)).length;
        const drafts = group.items.filter((i) => i.status === 'draft_ready');
        const finalItems = group.items.filter((i) => i.status === 'final_ready');
        const finals = finalItems.length;
        return (
          <div key={group.formatId || group.formatName} className="rounded-xl border border-border bg-card/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="grid size-8 place-items-center rounded-lg bg-muted/40">
                  <Clapperboard className="size-4 text-muted-foreground" aria-hidden />
                </div>
                <div>
                  <p className="text-[13.5px] font-medium text-foreground">{group.formatName}</p>
                  <p className="text-[11.5px] text-muted-foreground/60">
                    {group.items.length} items · {pending} pendientes
                    {generating > 0 && ` · ${generating} generando`}
                    {drafts.length > 0 && ` · ${drafts.length} drafts`}
                    {finals > 0 && ` · ${finals} finales`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending === 0 || busy !== null}
                  onClick={() => handleBatch(group.formatId, 'sample')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === `${group.formatId}:sample` ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Play className="size-3.5" aria-hidden />
                  )}
                  Muestra (2)
                </button>
                <button
                  type="button"
                  disabled={pending === 0 || busy !== null}
                  onClick={() => handleBatch(group.formatId, 'full')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === `${group.formatId}:full` ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Play className="size-3.5" aria-hidden />
                  )}
                  Lote completo
                </button>
              </div>
            </div>

            {drafts.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
                {drafts.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <p className="line-clamp-1 flex-1 text-muted-foreground/80">{d.scenePrompt}</p>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => handleFinal(d.id)}
                      className="shrink-0 rounded-lg border border-sky-400/40 px-2.5 py-1 text-[11.5px] text-sky-300 transition-colors hover:bg-sky-400/10 disabled:opacity-40"
                    >
                      {busy === `final:${d.id}` ? 'Encolando…' : 'Aprobar final 720p'}
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => handleRedoSamples(group.formatId)}
                  className="mt-1 text-[11px] text-muted-foreground/60 underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-40"
                >
                  {busy === `${group.formatId}:redo`
                    ? 'Regresando drafts…'
                    : 'La muestra no convence: regresar drafts al plan'}
                </button>
              </div>
            )}

            {finalItems.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
                {finalItems.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <p className="line-clamp-1 flex-1 text-muted-foreground/80">{f.scenePrompt}</p>
                    <span className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => handleWinner(f)}
                        title={
                          f.isWinner
                            ? 'Quitar la marca de ganador'
                            : 'Marcar como ganador: prioriza este formato en próximas campañas'
                        }
                        className={
                          f.isWinner
                            ? 'inline-flex items-center gap-1 rounded-lg border border-amber-400/50 bg-amber-400/10 px-2.5 py-1 text-[11.5px] text-amber-300 transition-colors hover:bg-amber-400/15 disabled:opacity-40'
                            : 'inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40'
                        }
                      >
                        <Trophy className="size-3" aria-hidden />
                        {f.isWinner ? 'Ganador' : 'Marcar ganador'}
                      </button>
                      <button
                        type="button"
                        disabled={!f.generationId}
                        onClick={() => setDistilling(f)}
                        className="rounded-lg border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                      >
                        Convertir en plantilla
                      </button>
                      <button
                        type="button"
                        disabled={!f.generationId}
                        onClick={() => setVarianting(f)}
                        className="rounded-lg border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                      >
                        Variante
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <ImagePackCard campaignId={campaignId} />

      <p className="text-[11.5px] text-muted-foreground/50">
        Los lotes se encolan escalonados (20 s entre videos). Los resultados aparecen en la pestaña de la
        campaña en la biblioteca; el draft se genera en 480p y el final aprobado en 720p con el mismo seed.
      </p>

      {distilling?.generationId && (
        <DistillDialog
          item={distilling}
          onClose={() => setDistilling(null)}
        />
      )}
      {varianting?.generationId && (
        <VariantDialog
          item={varianting}
          characterOptions={characterOptions}
          bridgeOptions={groups
            .flatMap((g) => g.items)
            .filter((i) => i.status === 'final_ready' && i.generationId && i.id !== varianting.id)}
          onClose={() => setVarianting(null)}
        />
      )}
    </div>
  );
}

function TemplatesView({ templates }: { templates: StudioTemplate[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [count, setCount] = useState(3);
  const [rotateCharacters, setRotateCharacters] = useState(false);

  async function handleSeries(templateId: string) {
    setBusy(templateId);
    const res = await generateSeriesAction({ templateId, count, rotateCharacters });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo generar la serie');
      return;
    }
    toast.success(`Serie creada: ${res.data.items} items en el plan — apruébalos desde Producción`);
  }

  if (templates.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-center gap-2 text-center text-muted-foreground/60">
        <p className="text-[14px] text-foreground/70">Sin plantillas todavía</p>
        <p className="max-w-md text-[12.5px]">
          Cuando un creativo final te funcione, conviértelo en plantilla desde Producción: su estructura,
          cámara y ritmo quedan fijos y puedes generar series rotando escena y personaje.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/50 p-3 text-[12.5px]">
        <span className="text-muted-foreground">Tamaño de la serie:</span>
        {[2, 3, 4, 6].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setCount(n)}
            className={`rounded-md border px-2.5 py-1 transition-colors ${
              count === n
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {n}
          </button>
        ))}
        <label className="ml-2 inline-flex items-center gap-2 text-muted-foreground">
          <input
            type="checkbox"
            checked={rotateCharacters}
            onChange={(e) => setRotateCharacters(e.target.checked)}
            className="accent-[#009fff]"
          />
          Rotar personajes del Cast
        </label>
      </div>

      <div className="space-y-2">
        {templates.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/50 p-4">
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-medium text-foreground">{t.name}</p>
              <p className="text-[11.5px] text-muted-foreground/60">
                {t.formatName} · usada {t.usesCount} {t.usesCount === 1 ? 'vez' : 'veces'}
              </p>
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => handleSeries(t.id)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground transition-opacity disabled:opacity-40"
            >
              {busy === t.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
              Generar serie ({count})
            </button>
          </div>
        ))}
      </div>
      <p className="text-[11.5px] text-muted-foreground/50">
        La serie copia la estructura, cámara y ritmo del video ganador (entra como referencia @Video1) y
        rota la escena{rotateCharacters ? ' y el personaje' : ''}. Los items nuevos aparecen en el plan
        como planificados y se generan desde Producción con las compuertas normales.
      </p>
    </div>
  );
}

function DistillDialog({ item, onClose }: { item: StudioItem; onClose: () => void }) {
  const [name, setName] = useState(`${item.formatName} ganador`);
  const [saving, setSaving] = useState(false);

  async function handleDistill() {
    if (!item.generationId) return;
    setSaving(true);
    const res = await distillTemplateAction({ generationId: item.generationId, name: name.trim() });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo crear la plantilla');
      return;
    }
    toast.success('Plantilla creada — está en la pestaña Plantillas');
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="mx-4 w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-[15px] font-semibold text-foreground">Convertir en plantilla</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground">
            <X className="size-4.5" aria-hidden />
          </button>
        </div>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          La estructura, cámara, ritmo y estilo de este video quedan fijos; producto, escena y personaje
          serán rotables al generar series.
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="Nombre de la plantilla"
          className="mt-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground">
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDistill}
            disabled={saving || name.trim().length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Crear plantilla
          </button>
        </div>
      </div>
    </div>
  );
}

type VariantMode = 'extend' | 'replace_character' | 'change_action' | 'bridge';

function VariantDialog({
  item,
  characterOptions,
  bridgeOptions,
  onClose,
}: {
  item: StudioItem;
  characterOptions: StudioCharacterOption[];
  // Otros finales de la campaña: destinos posibles de la escena puente.
  bridgeOptions: StudioItem[];
  onClose: () => void;
}) {
  const [mode, setMode] = useState<VariantMode>('extend');
  const [extendSeconds, setExtendSeconds] = useState(5);
  const [continuation, setContinuation] = useState('');
  const [characterId, setCharacterId] = useState(characterOptions[0]?.id ?? '');
  const [newAction, setNewAction] = useState('');
  const [targetId, setTargetId] = useState(bridgeOptions[0]?.generationId ?? '');
  const [bridgeSeconds, setBridgeSeconds] = useState(5);
  const [saving, setSaving] = useState(false);

  const canSubmit =
    mode === 'extend'
      ? true
      : mode === 'replace_character'
        ? characterId.length > 0
        : mode === 'change_action'
          ? newAction.trim().length > 0
          : targetId.length > 0;

  async function handleCreate() {
    if (!item.generationId) return;
    setSaving(true);
    const res = await createVariantAction({
      generationId: item.generationId,
      mode,
      ...(mode === 'extend'
        ? { extendSeconds, continuation: continuation.trim() || undefined }
        : mode === 'replace_character'
          ? { characterId }
          : mode === 'change_action'
            ? { newAction: newAction.trim() }
            : { targetGenerationId: targetId, bridgeSeconds }),
    });
    setSaving(false);
    if (!res.ok) {
      if (res.error === 'insufficient_credits') insufficientCreditsToast();
      else toast.error(res.message ?? 'No se pudo encolar la variante');
      return;
    }
    toast.success('Variante en cola — aparecerá en la biblioteca de la campaña');
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="mx-4 w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-[15px] font-semibold text-foreground">Variante dirigida</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground">
            <X className="size-4.5" aria-hidden />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg border border-border bg-background p-0.5">
          {(
            [
              { value: 'extend', label: 'Extender clip' },
              { value: 'replace_character', label: 'Cambiar personaje' },
              { value: 'change_action', label: 'Cambiar acción' },
              { value: 'bridge', label: 'Escena puente' },
            ] as const
          ).map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={`rounded-md px-3 py-1.5 text-[12.5px] transition-colors ${
                mode === m.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'extend' ? (
          <div className="mt-4 space-y-3">
            <div>
              <span className="text-[12.5px] font-medium text-foreground/80">Segundos a extender</span>
              <div className="mt-1.5 flex gap-2">
                {[4, 5, 6, 8].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setExtendSeconds(s)}
                    className={`flex-1 rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors ${
                      extendSeconds === s
                        ? 'border-primary/60 bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    +{s}s
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="variant-cont" className="text-[12.5px] font-medium text-foreground/80">
                Qué pasa en la continuación (opcional)
              </label>
              <textarea
                id="variant-cont"
                value={continuation}
                onChange={(e) => setContinuation(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="She sets the can down and looks back to camera with a smile"
                className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
              />
            </div>
          </div>
        ) : mode === 'replace_character' ? (
          <div className="mt-4">
            <label htmlFor="variant-char" className="text-[12.5px] font-medium text-foreground/80">
              Nuevo personaje (acciones, escena y cámara se conservan)
            </label>
            {characterOptions.length === 0 ? (
              <p className="mt-1.5 text-[12px] text-amber-400/80">No hay personajes en el Cast.</p>
            ) : (
              <select
                id="variant-char"
                value={characterId}
                onChange={(e) => setCharacterId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
              >
                {characterOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : mode === 'change_action' ? (
          <div className="mt-4">
            <label htmlFor="variant-action" className="text-[12.5px] font-medium text-foreground/80">
              Nueva acción o desenlace (sujeto, escena y cámara se conservan)
            </label>
            <textarea
              id="variant-action"
              value={newAction}
              onChange={(e) => setNewAction(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="She opens the can, takes a sip and raises it toward the camera"
              className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
            />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="variant-bridge" className="text-[12.5px] font-medium text-foreground/80">
                Clip destino (el puente conecta el final de este clip con su inicio)
              </label>
              {bridgeOptions.length === 0 ? (
                <p className="mt-1.5 text-[12px] text-amber-400/80">
                  Necesitas otro final terminado en la campaña para conectar.
                </p>
              ) : (
                <select
                  id="variant-bridge"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
                >
                  {bridgeOptions.map((b) => (
                    <option key={b.id} value={b.generationId ?? ''}>
                      {b.formatName} · {b.scenePrompt.slice(0, 60)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <span className="text-[12.5px] font-medium text-foreground/80">Duración del puente</span>
              <div className="mt-1.5 flex gap-2">
                {[4, 5, 6, 8].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setBridgeSeconds(s)}
                    className={`flex-1 rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors ${
                      bridgeSeconds === s
                        ? 'border-primary/60 bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {s}s
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground">
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving || !canSubmit}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Encolar variante
          </button>
        </div>
      </div>
    </div>
  );
}

function EditItemDialog({
  item,
  characterOptions,
  onClose,
  onSaved,
}: {
  item: StudioItem;
  characterOptions: StudioCharacterOption[];
  onClose: () => void;
  onSaved: (patch: Partial<StudioItem>) => void;
}) {
  const [scenePrompt, setScenePrompt] = useState(item.scenePrompt);
  const [scene, setScene] = useState(item.scene ?? '');
  const [characterId, setCharacterId] = useState(
    characterOptions.find((c) => c.name === item.characterName)?.id ?? '',
  );
  const [caption, setCaption] = useState(item.caption ?? '');
  const [scheduledDate, setScheduledDate] = useState(item.scheduledDate ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const res = await updateCampaignItemAction({
      itemId: item.id,
      scenePrompt,
      scene: scene.trim() || undefined,
      ...(characterId ? { characterId } : {}),
      caption,
      ...(scheduledDate ? { scheduledDate: new Date(`${scheduledDate}T12:00:00`) } : {}),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo guardar');
      return;
    }
    onSaved({
      scenePrompt,
      scene: scene.trim() || item.scene,
      characterName: characterId
        ? (characterOptions.find((c) => c.id === characterId)?.name ?? item.characterName)
        : item.characterName,
      caption: caption || null,
      scheduledDate: scheduledDate || item.scheduledDate,
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="mx-4 w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-[15px] font-semibold text-foreground">Editar creativo · {item.formatName}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground">
            <X className="size-4.5" aria-hidden />
          </button>
        </div>

        <label htmlFor="edit-prompt" className="mt-4 block text-[12.5px] font-medium text-foreground/80">
          Acción de la escena
        </label>
        <textarea
          id="edit-prompt"
          value={scenePrompt}
          onChange={(e) => setScenePrompt(e.target.value)}
          rows={4}
          maxLength={4000}
          className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="edit-scene" className="block text-[12.5px] font-medium text-foreground/80">
              Escena (fragmento de contexto)
            </label>
            <input
              id="edit-scene"
              value={scene}
              onChange={(e) => setScene(e.target.value)}
              maxLength={200}
              placeholder="a sunlit home kitchen"
              className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/50"
            />
          </div>
          <div>
            <label htmlFor="edit-character" className="block text-[12.5px] font-medium text-foreground/80">
              Personaje
            </label>
            <select
              id="edit-character"
              value={characterId}
              onChange={(e) => setCharacterId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
            >
              <option value="">Sin cambio / sin personaje</option>
              {characterOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label htmlFor="edit-caption" className="mt-3 block text-[12.5px] font-medium text-foreground/80">
          Caption de publicación
        </label>
        <textarea
          id="edit-caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={2}
          maxLength={2200}
          placeholder="Texto que acompaña al post; va al export, nunca dentro del video"
          className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/50"
        />

        <label htmlFor="edit-date" className="mt-3 block text-[12.5px] font-medium text-foreground/80">
          Fecha programada
        </label>
        <input
          id="edit-date"
          type="date"
          value={scheduledDate}
          onChange={(e) => setScheduledDate(e.target.value)}
          className="mt-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || scenePrompt.trim().length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function AddItemDialog({
  campaignId,
  formatOptions,
  characterOptions,
  onClose,
  onAdded,
}: {
  campaignId: string;
  formatOptions: StudioFormatOption[];
  characterOptions: StudioCharacterOption[];
  onClose: () => void;
  onAdded: (item: StudioItem) => void;
}) {
  const [formatId, setFormatId] = useState(formatOptions[0]?.id ?? '');
  const [scenePrompt, setScenePrompt] = useState('');
  const [scene, setScene] = useState('');
  const [characterId, setCharacterId] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [saving, setSaving] = useState(false);

  const canSubmit = formatId.length > 0 && scenePrompt.trim().length > 0 && !saving;

  async function handleAdd() {
    if (!canSubmit) return;
    setSaving(true);
    const res = await addCampaignItemAction({
      campaignId,
      formatId,
      scenePrompt: scenePrompt.trim(),
      scene: scene.trim() || undefined,
      ...(characterId ? { characterId } : {}),
      ...(scheduledDate ? { scheduledDate: new Date(`${scheduledDate}T12:00:00`) } : {}),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo agregar el creativo');
      return;
    }
    onAdded({
      id: res.data.id,
      formatId,
      formatName: formatOptions.find((f) => f.id === formatId)?.name ?? 'Formato',
      templateId: null,
      durationS: res.data.durationS,
      aspectRatio: res.data.aspectRatio,
      scene: scene.trim() || null,
      scenePrompt: scenePrompt.trim(),
      caption: res.data.caption,
      characterName: characterId
        ? (characterOptions.find((c) => c.id === characterId)?.name ?? null)
        : null,
      scheduledDate: res.data.scheduledDate,
      status: 'planned',
      warnings: [],
      generationId: null,
      isWinner: false,
    });
    toast.success('Creativo agregado al plan');
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="mx-4 w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-[15px] font-semibold text-foreground">Agregar creativo al plan</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground">
            <X className="size-4.5" aria-hidden />
          </button>
        </div>

        <label htmlFor="add-format" className="mt-4 block text-[12.5px] font-medium text-foreground/80">
          Formato
        </label>
        <select
          id="add-format"
          value={formatId}
          onChange={(e) => setFormatId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
        >
          {formatOptions.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>

        <label htmlFor="add-prompt" className="mt-3 block text-[12.5px] font-medium text-foreground/80">
          Acción de la escena
        </label>
        <textarea
          id="add-prompt"
          value={scenePrompt}
          onChange={(e) => setScenePrompt(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="The presenter lifts the product into frame and shares a one-sentence take"
          className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/50"
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="add-scene" className="block text-[12.5px] font-medium text-foreground/80">
              Escena (opcional)
            </label>
            <input
              id="add-scene"
              value={scene}
              onChange={(e) => setScene(e.target.value)}
              maxLength={200}
              placeholder="a sunlit home kitchen"
              className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/50"
            />
          </div>
          <div>
            <label htmlFor="add-character" className="block text-[12.5px] font-medium text-foreground/80">
              Personaje (opcional)
            </label>
            <select
              id="add-character"
              value={characterId}
              onChange={(e) => setCharacterId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
            >
              <option value="">Sin personaje</option>
              {characterOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label htmlFor="add-date" className="mt-3 block text-[12.5px] font-medium text-foreground/80">
          Fecha programada (opcional)
        </label>
        <input
          id="add-date"
          type="date"
          value={scheduledDate}
          onChange={(e) => setScheduledDate(e.target.value)}
          className="mt-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}
