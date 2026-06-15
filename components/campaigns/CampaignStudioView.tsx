'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarDays,
  Clapperboard,
  Download,
  Eye,
  FileBarChart,
  Info,
  Layers,
  Loader2,
  Pencil,
  Play,
  Sparkles,
  Trash2,
  Trophy,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import {
  approveBatchAction,
  createVariantAction,
  deleteCampaignItemAction,
  distillTemplateAction,
  exportCampaignCsvAction,
  generateSeriesAction,
  mergeSequenceAction,
  previewItemPromptAction,
  redoSamplesAction,
  requestFinalAction,
  toggleWinnerAction,
  updateCampaignItemAction,
} from '@/server-actions/campaigns';
import { groupPlanItems } from '@/lib/campaigns/plan-grouping';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { CalendarView, ImagePackCard } from './CampaignCalendar';
import { GenerationViewer } from './GenerationViewer';
import { insufficientCreditsToast } from './credits-toast';

export type StudioItem = {
  id: string;
  formatId: string | null;
  formatName: string;
  formatDescription: string;
  templateId: string | null;
  durationS: number | null;
  aspectRatio: string | null;
  scene: string | null;
  scenePrompt: string;
  // Resumen display en el idioma de la campaña (033); null cae a scenePrompt.
  sceneSummary: string | null;
  caption: string | null;
  characterNames: string[];
  scheduledDate: string | null;
  status: string;
  warnings: string[];
  generationId: string | null;
  isWinner: boolean;
  sequenceId: string | null;
  sceneIndex: number | null;
  sequenceLabel: string | null;
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
  draft_ready: { label: 'borrador listo', tone: 'text-emerald-400/90 border-emerald-400/30' },
  approved: { label: 'versión final…', tone: 'text-sky-400/90 border-sky-400/30', live: true },
  final_ready: { label: 'versión final lista', tone: 'text-sky-300 border-sky-300/40' },
  failed: { label: 'falló', tone: 'text-red-400/90 border-red-400/30' },
  skipped: { label: 'bloqueado', tone: 'text-amber-400/90 border-amber-400/30' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? STATUS_LABEL.planned;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${s.tone}`}>
      {s.live && <Loader2 className="size-2.5 animate-spin" aria-hidden />}
      {s.label}
    </span>
  );
}


export function CampaignStudioView({
  campaign,
  initialItems,
  templates,
  characterOptions,
}: {
  campaign: StudioCampaign;
  initialItems: StudioItem[];
  templates: StudioTemplate[];
  characterOptions: StudioCharacterOption[];
}) {
  const [items, setItems] = useState(initialItems);
  const [tab, setTab] = useState<'plan' | 'produccion' | 'plantillas' | 'calendario'>('plan');
  const [editing, setEditing] = useState<StudioItem | null>(null);
  const [exporting, setExporting] = useState(false);
  const [promptPreview, setPromptPreview] = useState<{
    itemId: string;
    loading: boolean;
    prompt: string | null;
    references: Array<{ kind: string; role: string; path: string }>;
    warnings: string[];
    errors: string[];
  } | null>(null);

  async function handlePreviewPrompt(itemId: string) {
    setPromptPreview({ itemId, loading: true, prompt: null, references: [], warnings: [], errors: [] });
    const res = await previewItemPromptAction(itemId);
    if (!res.ok) {
      setPromptPreview(null);
      toast.error('No se pudo compilar el prompt');
      return;
    }
    setPromptPreview({ itemId, loading: false, ...res.data });
  }

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
            {campaign.creditsEstimated ? ` · ~${campaign.creditsEstimated} cr en borradores` : ''}
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
            <Link
              href={`/app/campaigns/${campaign.id}/refine/new`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Sparkles className="size-3.5" aria-hidden />
              Agregar creativo
            </Link>
          </div>
          <PlanTable
            campaignId={campaign.id}
            items={items}
            onEdit={setEditing}
            onPreview={handlePreviewPrompt}
            onDeleted={(id) => setItems((p) => p.filter((i) => i.id !== id))}
            onSequenceMerged={(sequenceId) =>
              setItems((p) => p.filter((i) => i.sequenceId !== sequenceId))
            }
          />
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

      {promptPreview && (
        <PromptPreviewDialog preview={promptPreview} onClose={() => setPromptPreview(null)} />
      )}

    </div>
  );
}

function PlanTable({
  campaignId,
  items,
  onEdit,
  onPreview,
  onDeleted,
  onSequenceMerged,
}: {
  campaignId: string;
  items: StudioItem[];
  onEdit: (item: StudioItem) => void;
  onPreview: (id: string) => void;
  onDeleted: (id: string) => void;
  onSequenceMerged: (sequenceId: string) => void;
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

  async function handleMergeSequence(sequenceId: string) {
    const res = await mergeSequenceAction({ sequenceId, campaignId });
    if (res.ok) {
      onSequenceMerged(sequenceId);
    } else {
      toast.error(res.message ?? 'No se pudo unir la secuencia');
    }
  }

  function renderPlanRow(item: StudioItem) {
    return (
      <tr key={item.id} className="border-b border-border/50 last:border-0">
        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-3 text-muted-foreground/40" aria-hidden />
            {item.scheduledDate
              ? new Date(`${item.scheduledDate}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
              : '—'}
          </span>
        </td>
        <td
          className="whitespace-nowrap px-3 py-2.5 text-foreground/90"
          title={item.formatDescription || undefined}
        >
          {item.formatName}
          {item.templateId && (
            <span className="ml-1.5 rounded-full border border-primary/40 px-1.5 py-0.5 text-[11px] text-primary">
              serie
            </span>
          )}
          {item.characterNames.length > 0 && (
            <span className="ml-1.5 text-[11px] text-muted-foreground/60">
              · {item.characterNames.join(' + ')}
            </span>
          )}
        </td>
        <td className="hidden max-w-md px-3 py-2.5 md:table-cell">
          {item.scene && (
            <p className="line-clamp-1 text-[11px] text-muted-foreground/50">{item.scene}</p>
          )}
          <p className="line-clamp-2 text-muted-foreground/80">
            {item.sceneSummary ?? item.scenePrompt}
          </p>
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
          <span className="inline-flex gap-1">
            {editable(item.status) && (
              <>
                <Link
                  href={`/app/campaigns/${campaignId}/refine/${item.id}`}
                  aria-label="Refinar con asistente"
                  className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-primary"
                >
                  <Sparkles className="size-3.5" aria-hidden />
                </Link>
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
              </>
            )}
            <button
              type="button"
              onClick={() => onPreview(item.id)}
              aria-label="Ver prompt final"
              className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            >
              <Eye className="size-3.5" aria-hidden />
            </button>
          </span>
        </td>
      </tr>
    );
  }

  const groups = groupPlanItems(items);
  // Feedback de la decisión del matcher (clip único vs. secuencia multi-escena):
  // resumir cuántas escenas quedaron agrupadas en anuncios y cuántos clips sueltos.
  const sequenceGroups = groups.filter(
    (g): g is Extract<typeof g, { kind: 'sequence' }> => g.kind === 'sequence',
  );
  const sequenceScenes = sequenceGroups.reduce((n, g) => n + g.scenes.length, 0);
  const singleCount = groups.filter((g) => g.kind === 'single').length;

  return (
    <div className="mt-5 space-y-3">
      {sequenceGroups.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/[0.06] px-3 py-2.5 text-[12px] leading-snug text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
          <p>
            La IA interpretó tus ideas y creó{' '}
            <span className="text-foreground">
              {sequenceScenes} escenas en {sequenceGroups.length} secuencia
              {sequenceGroups.length > 1 ? 's' : ''}
            </span>
            {singleCount > 0 && (
              <>
                {' '}y{' '}
                <span className="text-foreground">
                  {singleCount} clip{singleCount > 1 ? 's' : ''} suelto
                  {singleCount > 1 ? 's' : ''}
                </span>
              </>
            )}
            . Cada escena se genera por separado en Producción; une una secuencia
            para obtener un solo video continuo.
          </p>
        </div>
      )}
      {groups.map((group) =>
        group.kind === 'single' ? (
          <div key={group.item.id} className="overflow-hidden rounded-xl border border-border">
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
              <tbody>{renderPlanRow(group.item)}</tbody>
            </table>
          </div>
        ) : (
          <div key={group.sequenceId} className="rounded-xl border border-border bg-card/40 p-3">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-foreground">
                  <Layers className="size-3.5 text-primary" aria-hidden />
                  Secuencia{group.label ? `: «${group.label}»` : ''} · {group.scenes.length} escenas
                  <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-primary">
                    sugerida por IA
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
                  La IA dividió esta idea en {group.scenes.length} escenas que se generan por
                  separado y juntas forman un anuncio.
                </p>
              </div>
              <button
                type="button"
                title={`Une las ${group.scenes.length} escenas en un solo video continuo (máx 15s). Si no las unes, se generan por separado.`}
                className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => handleMergeSequence(group.sequenceId)}
              >
                Unir en 1 clip
              </button>
            </div>
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-left text-[12.5px]">
                <thead className="border-b border-border bg-muted/20 text-[11px] uppercase tracking-wide text-muted-foreground/60">
                  <tr>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Fecha</th>
                    <th className="px-3 py-2 font-medium">Formato</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">Escena / acción</th>
                    <th className="px-3 py-2 font-medium">Estado</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {group.scenes.map((scene, i) => (
                    <tr key={scene.id} className="border-b border-border/50 last:border-0">
                      <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-zinc-500">{i + 1}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarDays className="size-3 text-muted-foreground/40" aria-hidden />
                          {scene.scheduledDate
                            ? new Date(`${scene.scheduledDate}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
                            : '—'}
                        </span>
                      </td>
                      <td
                        className="whitespace-nowrap px-3 py-2.5 text-foreground/90"
                        title={scene.formatDescription || undefined}
                      >
                        {scene.formatName}
                        {scene.templateId && (
                          <span className="ml-1.5 rounded-full border border-primary/40 px-1.5 py-0.5 text-[11px] text-primary">
                            serie
                          </span>
                        )}
                        {scene.characterNames.length > 0 && (
                          <span className="ml-1.5 text-[11px] text-muted-foreground/60">
                            · {scene.characterNames.join(' + ')}
                          </span>
                        )}
                      </td>
                      <td className="hidden max-w-md px-3 py-2.5 md:table-cell">
                        {scene.scene && (
                          <p className="line-clamp-1 text-[11px] text-muted-foreground/50">{scene.scene}</p>
                        )}
                        <p className="line-clamp-2 text-muted-foreground/80">
                          {scene.sceneSummary ?? scene.scenePrompt}
                        </p>
                        {scene.caption && (
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground/50">
                            Caption: {scene.caption}
                          </p>
                        )}
                        {scene.warnings.length > 0 && (
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-amber-400/70">{scene.warnings[0]}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <StatusBadge status={scene.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <span className="inline-flex gap-1">
                          {editable(scene.status) && (
                            <>
                              <Link
                                href={`/app/campaigns/${campaignId}/refine/${scene.id}`}
                                aria-label="Refinar con asistente"
                                className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-primary"
                              >
                                <Sparkles className="size-3.5" aria-hidden />
                              </Link>
                              <button
                                type="button"
                                onClick={() => onEdit(scene)}
                                aria-label="Editar item"
                                className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                              >
                                <Pencil className="size-3.5" aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(scene)}
                                aria-label="Eliminar item"
                                className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-red-400"
                              >
                                <Trash2 className="size-3.5" aria-hidden />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => onPreview(scene.id)}
                            aria-label="Ver prompt final"
                            className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <Eye className="size-3.5" aria-hidden />
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ),
      )}
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
  // Visor inline del creativo generado (evita ir a la Biblioteca).
  const [viewing, setViewing] = useState<{ generationId: string; title: string } | null>(null);

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
    toast.success('Versión final en cola (720p, misma composición)');
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
      `${res.data.reset} borradores regresaron al plan: edítalos o vuelve a tirar la muestra (cobra créditos de nuevo)`,
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
        // Secuencias dentro de este grupo de formato: el flujo de lotes las
        // aplana, así que se rotula su pertenencia y se avisa que el muestreo
        // parcial («Muestra (2)») rompe el orden narrativo del anuncio.
        const sequenceItems = group.items.filter((i) => i.sequenceId != null);
        const sequences = [
          ...new Map(
            sequenceItems.map((i) => [i.sequenceId as string, i.sequenceLabel]),
          ).entries(),
        ];
        // Creativos sueltos aún por generar: lo único que el muestreo parcial
        // puede tocar. Sin ellos (grupo solo-secuencia) la muestra no aplica:
        // una secuencia se genera completa y en orden (ver enqueueBatch).
        const loosePending = group.items.filter(
          (i) => i.sequenceId == null && ['planned', 'failed'].includes(i.status),
        ).length;
        const pureSequence = sequences.length > 0 && loosePending === 0;
        return (
          <div key={group.formatId || group.formatName} className="rounded-xl border border-border bg-card/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="grid size-8 place-items-center rounded-lg bg-muted/40">
                  <Clapperboard className="size-4 text-muted-foreground" aria-hidden />
                </div>
                <div title={group.items[0]?.formatDescription || undefined}>
                  <p className="text-[13.5px] font-medium text-foreground">{group.formatName}</p>
                  <p className="text-[11.5px] text-muted-foreground/60">
                    {group.items.length} creativos · {pending} pendientes
                    {generating > 0 && ` · ${generating} generando`}
                    {drafts.length > 0 && ` · ${drafts.length} borradores`}
                    {finals > 0 && ` · ${finals} finales`}
                  </p>
                  {sequences.map(([sid, label]) => {
                    const n = sequenceItems.filter((i) => i.sequenceId === sid).length;
                    return (
                      <p
                        key={sid}
                        className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground/80"
                      >
                        <Layers className="size-3 text-primary/70" aria-hidden />
                        Secuencia{label ? ` «${label}»` : ''}: {n} escenas en orden
                      </p>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending === 0 || busy !== null || pureSequence}
                  title={
                    pureSequence
                      ? 'Una secuencia se genera completa y en orden: usa «Lote completo».'
                      : undefined
                  }
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

            {sequences.length > 0 && pending > 0 && (
              <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-2 text-[11.5px] leading-snug text-amber-300/90">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  {pureSequence
                    ? 'Una secuencia se genera completa y en orden. «Lote completo» encola las escenas del anuncio.'
                    : '«Muestra (2)» aplica solo a los clips sueltos; la secuencia se genera completa con «Lote completo».'}
                </span>
              </p>
            )}

            {drafts.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
                {drafts.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <p className="line-clamp-1 flex-1 text-muted-foreground/80">
                      {d.sceneSummary ?? d.scenePrompt}
                    </p>
                    <span className="flex shrink-0 gap-1.5">
                      {d.generationId && (
                        <button
                          type="button"
                          onClick={() =>
                            setViewing({
                              generationId: d.generationId as string,
                              title: d.sceneSummary ?? d.scenePrompt,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <Play className="size-3" aria-hidden />
                          Ver
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => handleFinal(d.id)}
                        className="rounded-lg border border-sky-400/40 px-2.5 py-1 text-[11.5px] text-sky-300 transition-colors hover:bg-sky-400/10 disabled:opacity-40"
                      >
                        {busy === `final:${d.id}` ? 'Encolando…' : 'Aprobar versión final (720p)'}
                      </button>
                    </span>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => handleRedoSamples(group.formatId)}
                  className="mt-1 text-[11px] text-muted-foreground/60 underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-40"
                >
                  {busy === `${group.formatId}:redo`
                    ? 'Regresando borradores…'
                    : 'La muestra no convence: regresar borradores al plan'}
                </button>
              </div>
            )}

            {finalItems.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
                {finalItems.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <p className="line-clamp-1 flex-1 text-muted-foreground/80">
                      {f.sceneSummary ?? f.scenePrompt}
                    </p>
                    <span className="flex shrink-0 gap-1.5">
                      {f.generationId && (
                        <button
                          type="button"
                          onClick={() =>
                            setViewing({
                              generationId: f.generationId as string,
                              title: f.sceneSummary ?? f.scenePrompt,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <Play className="size-3" aria-hidden />
                          Ver
                        </button>
                      )}
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
        Los lotes se encolan escalonados (20 s entre videos). Cuando un creativo termina, ábrelo con
        &ldquo;Ver&rdquo; aquí mismo; el borrador se genera en 480p y la versión final aprobada en 720p con la misma composición.
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
      {viewing && (
        <GenerationViewer
          generationId={viewing.generationId}
          title={viewing.title}
          onClose={() => setViewing(null)}
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
        <span className="ml-2 inline-flex items-center gap-2 text-muted-foreground">
          Rotar personajes del Cast
          <Switch
            checked={rotateCharacters}
            onCheckedChange={setRotateCharacters}
            size="sm"
            aria-label="Rotar personajes del Cast"
          />
        </span>
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convertir en plantilla</DialogTitle>
          <DialogDescription>
            La estructura, cámara, ritmo y estilo de este video quedan fijos; producto, escena y
            personaje serán rotables al generar series.
          </DialogDescription>
        </DialogHeader>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="Nombre de la plantilla"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <div className="flex justify-end gap-2">
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
      </DialogContent>
    </Dialog>
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Variante dirigida</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-background p-0.5">
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
                className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
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
                className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
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
              className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
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
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {bridgeOptions.map((b) => (
                    <option key={b.id} value={b.generationId ?? ''}>
                      {b.formatName} · {(b.sceneSummary ?? b.scenePrompt).slice(0, 60)}
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

        <div className="flex justify-end gap-2">
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
      </DialogContent>
    </Dialog>
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
    characterOptions.find((c) => c.name === (item.characterNames[0] ?? null))?.id ?? '',
  );
  const [caption, setCaption] = useState(item.caption ?? '');
  const [scheduledDate, setScheduledDate] = useState(item.scheduledDate ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const res = await updateCampaignItemAction({
      itemId: item.id,
      // Solo si cambió: enviarlo siempre anularía el resumen display (033)
      // que la action invalida con cada edición del prompt.
      ...(scenePrompt !== item.scenePrompt ? { scenePrompt } : {}),
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
      // El resumen describía el prompt anterior: la action lo anula al editar.
      ...(scenePrompt !== item.scenePrompt ? { sceneSummary: null } : {}),
      scene: scene.trim() || item.scene,
      characterNames: characterId
        ? (() => {
            const name = characterOptions.find((c) => c.id === characterId)?.name;
            if (!name) return item.characterNames;
            const rest = item.characterNames.slice(1).filter((n) => n !== name);
            return [name, ...rest];
          })()
        : item.characterNames,
      caption: caption || null,
      scheduledDate: scheduledDate || item.scheduledDate,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar creativo · {item.formatName}</DialogTitle>
        </DialogHeader>

        <label htmlFor="edit-prompt" className="block text-[12.5px] font-medium text-foreground/80">
          Acción de la escena
        </label>
        <textarea
          id="edit-prompt"
          value={scenePrompt}
          onChange={(e) => setScenePrompt(e.target.value)}
          rows={4}
          maxLength={4000}
          className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
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
              className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
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
          className="mt-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
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
      </DialogContent>
    </Dialog>
  );
}

function PromptPreviewDialog({
  preview,
  onClose,
}: {
  preview: {
    loading: boolean;
    prompt: string | null;
    references: Array<{ kind: string; role: string; path: string }>;
    warnings: string[];
    errors: string[];
  };
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Prompt final (preview)</DialogTitle>
          <DialogDescription>
            Así se compila este creativo al generar: referencias con propósito, contexto,
            acción y dirección del formato. El texto del plan es solo la acción.
          </DialogDescription>
        </DialogHeader>
        {preview.loading ? (
          <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Compilando…
          </div>
        ) : preview.errors.length > 0 ? (
          <div className="space-y-1 text-[12.5px] text-red-300/90">
            {preview.errors.map((e) => (
              <p key={e}>{e}</p>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-3 text-[12px] leading-relaxed text-foreground/90">
              {preview.prompt}
            </pre>
            {preview.references.length > 0 && (
              <div className="text-[11.5px] text-muted-foreground">
                <p className="font-medium text-foreground/70">Referencias ({preview.references.length})</p>
                <ul className="mt-1 space-y-0.5">
                  {preview.references.map((r, i) => (
                    <li key={`${r.path}-${i}`}>
                      {r.kind === 'image' ? 'Imagen' : r.kind === 'video' ? 'Video' : 'Audio'} — {r.role}
                      <span className="ml-1 text-muted-foreground/50">{r.path.split('/').pop()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.warnings.length > 0 && (
              <div className="text-[11.5px] text-amber-300/80">
                {preview.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
