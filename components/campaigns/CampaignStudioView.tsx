'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  Trophy,
  Wand2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { cancelGenerationAction } from '@/server-actions/generations';
import {
  approveBatchAction,
  assignSequenceLocationAction,
  createVariantAction,
  deleteCampaignItemAction,
  distillTemplateAction,
  exportCampaignCsvAction,
  generateItemAction,
  generatePlanAction,
  generateSeriesAction,
  mergeSequenceAction,
  previewItemPromptAction,
  redoSamplesAction,
  requestFinalAction,
  setCampaignStatusAction,
  setItemProductAction,
  toggleWinnerAction,
  updateCampaignItemAction,
  updateCampaignStudioAction,
  type RegenMode,
} from '@/server-actions/campaigns';
import { groupPlanItems } from '@/lib/campaigns/plan-grouping';
import { MATCHER_ERROR_HINTS } from '@/lib/campaigns/matcher-hints';
import { regenModesFor } from '@/lib/campaigns/sequence-chain';
import { seedanceCostPerItem } from '@/lib/campaigns/estimate';
import { clipDownloadName } from '@/lib/campaigns/clip-download-name';
import { downloadGenerationImage as downloadFile } from '@/lib/media-references/download-client';
import type { PricingRow } from '@/lib/credits/types';
import type { StudioItem } from '@/lib/campaigns/studio-item';
import { ReferencePoolDialog } from './ReferencePoolDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { CalendarView, ImagePackCard } from './CampaignCalendar';
import { GenerationViewer } from './GenerationViewer';
import { insufficientCreditsToast } from './credits-toast';
import { ProductSizeEditor } from './ProductSizeEditor';
import { CreativeGuidelinesEditor } from './CreativeGuidelinesEditor';

// StudioItem vive en lib/campaigns/studio-item (compartido con el loader y las
// server actions); se re-exporta para no romper imports existentes.
export type { StudioItem };

export type StudioTemplate = {
  id: string;
  name: string;
  formatName: string;
  usesCount: number;
};

export type StudioCharacterOption = {
  id: string;
  name: string;
  states: string[];
  // Vestuario (specs/v2/16): labels de character_outfits del personaje, para
  // el override por clip en el editor (mismo canal que states).
  outfits: string[];
};
export type StudioLocationOption = { id: string; name: string };

// V3 multi-producto (Fase 3): entrada del pool de productos de la campaña,
// para el selector por clip en PlanTable.
export type StudioProductPoolEntry = { id: string; name: string; imageCount: number };

export type StudioCampaign = {
  id: string;
  name: string;
  status: string;
  goal: string | null;
  productName: string;
  category: string;
  creditsEstimated: number | null;
  // Idea con que se generó el plan (P: reprocesar idea). null = se generó por mix.
  ideaText: string | null;
  productHeightCm?: number;
  productWidthCm?: number;
  productMedium?: string;
  productThicknessMm?: number;
  productWeightKg?: number;
  guidelines?: { showFullProduct?: boolean; hookProductHero?: boolean; safeCrop?: '4:5' | null; safeAreaExtend?: boolean };
  aspectRatio?: string | null;
  // V3 multi-producto (Fase 3): marca de la campaña (gating de Task 5) y el
  // pool de productos disponibles para asignar por clip.
  brandKitId: string | null;
  productPool: StudioProductPoolEntry[];
};

// Mirror de server-actions/campaigns.ts (requestFinalAction): el final se renderiza con
// Seedance reference-to-video; el costo per-item = duración × tarifa/segundo de la resolución.
const FINAL_MODEL = 'bytedance/seedance-2.0/reference-to-video';

const STATUS_LABEL: Record<string, { label: string; tone: string; live?: boolean }> = {
  planned: { label: 'planificado', tone: 'text-muted-foreground/70 border-border' },
  sample: { label: 'muestra…', tone: 'text-brand/90 border-brand/30', live: true },
  queued: { label: 'generando…', tone: 'text-brand/90 border-brand/30', live: true },
  draft_ready: { label: 'borrador listo', tone: 'text-emerald-400/90 border-emerald-400/30' },
  approved: { label: 'versión final…', tone: 'text-brand/90 border-brand/30', live: true },
  final_ready: { label: 'versión final lista', tone: 'text-brand border-brand/40' },
  failed: { label: 'falló', tone: 'text-red-400/90 border-red-400/30' },
  skipped: { label: 'bloqueado', tone: 'text-amber-400/90 border-amber-400/30' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? STATUS_LABEL.planned;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs ${s.tone}`}>
      {s.live && <Loader2 className="size-2.5 animate-spin" aria-hidden />}
      {s.label}
    </span>
  );
}


const STUDIO_TABS = ['plan', 'produccion', 'plantillas', 'calendario'] as const;

export function CampaignStudioView({
  campaign,
  initialItems,
  templates,
  characterOptions,
  locationOptions,
  planNotice,
  pricing,
}: {
  campaign: StudioCampaign;
  initialItems: StudioItem[];
  templates: StudioTemplate[];
  characterOptions: StudioCharacterOption[];
  locationOptions: StudioLocationOption[];
  // R6: si el matcher degradó el plan a un mix genérico, el wizard navega con
  // ?plan=generic; el aviso vive aquí como banner persistente (no un toast efímero).
  planNotice: { reason: string | null } | null;
  // Filas de model_pricing para estimar costos en cliente (finales de video, pack).
  pricing: PricingRow[];
}) {
  const [items, setItems] = useState(initialItems);
  const [planNoticeDismissed, setPlanNoticeDismissed] = useState(false);
  const [tab, setTab] = useState<'plan' | 'produccion' | 'plantillas' | 'calendario'>('plan');
  const [editing, setEditing] = useState<StudioItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [promptPreview, setPromptPreview] = useState<{
    itemId: string;
    loading: boolean;
    prompt: string | null;
    references: Array<{ kind: string; role: string; path: string }>;
    warnings: string[];
    errors: string[];
  } | null>(null);

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Reprocesar idea: re-corre el matcher (Gemini) y reemplaza los borradores del
  // plan por lo que la IA interprete de la idea. Pre-llena con la idea guardada.
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [reprocessIdea, setReprocessIdea] = useState(campaign.ideaText ?? '');
  const [reprocessing, setReprocessing] = useState(false);
  // Motivo inline cuando vuelve a caer al mix (no degradar en silencio): se queda
  // en el diálogo para que el usuario refine la idea y reintente sin perder contexto.
  const [reprocessError, setReprocessError] = useState<string | null>(null);
  // Resumen de éxito CON avisos (inventados/ideas no convertibles): se muestra
  // inline con un botón para recargar y ver el plan, así el aviso no se pierde.
  const [reprocessDone, setReprocessDone] = useState<{ items: number; credits: number; notes: string[] } | null>(null);

  async function handleReprocess() {
    const idea = reprocessIdea.trim();
    if (!idea) return;
    setReprocessing(true);
    setReprocessError(null);
    const res = await generatePlanAction({ campaignId: campaign.id, userIdeas: idea });
    if (!res.ok) {
      setReprocessing(false);
      setReprocessError(res.message ?? 'No se pudo reprocesar la idea');
      return;
    }
    if (res.data.source === 'mix') {
      // El matcher no interpretó la idea: explicar por qué, sin cerrar el diálogo.
      setReprocessing(false);
      const reason = MATCHER_ERROR_HINTS[res.data.matcherError ?? ''] ?? 'no se pudo consultar a Gemini';
      const blockers = res.data.blockers?.length ? ` ${res.data.blockers.join(' · ')}` : '';
      setReprocessError(
        `No pude interpretar tu idea (${reason}). Reescríbela diciendo qué pasa en pantalla (una acción concreta).${blockers}`,
      );
      return;
    }
    // source === 'ideas': el plan se reemplazó por los creativos interpretados.
    // Avisos que NO deben perderse (nunca degradar en silencio): personajes
    // inventados e ideas no convertibles. Si los hay, se muestran INLINE en el
    // diálogo (un toast moriría con el reload); si no hay nada que avisar, se
    // recarga directo para mostrar el plan nuevo (el plan local se sembró una vez).
    const notes: string[] = [];
    if (res.data.inventedNames?.length) {
      notes.push(
        `${res.data.inventedNames.join(', ')}: no está(n) en la campaña, se inventó su apariencia (sin imagen de referencia).`,
      );
    }
    if (res.data.blockers?.length) {
      notes.push(
        `No pude convertir algunas ideas en tomas: ${res.data.blockers.join(' · ')}. Reescríbelas con una acción concreta.`,
      );
    }
    if (notes.length === 0) {
      window.location.reload();
      return;
    }
    setReprocessing(false);
    setReprocessDone({ items: res.data.items, credits: res.data.creditsEstimated, notes });
  }

  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, idx: number) {
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % STUDIO_TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + STUDIO_TABS.length) % STUDIO_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = STUDIO_TABS.length - 1;
    if (next !== null) {
      e.preventDefault();
      setTab(STUDIO_TABS[next]);
      tabRefs.current[next]?.focus();
    }
  }

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
                  // El payload trae la fila nueva completa: un generation_id
                  // null es un reset real (redoSamples/regenerar) y debe
                  // limpiarse, no conservar el id viejo (botón "Ver" muerto).
                  generationId: r.generation_id !== undefined ? r.generation_id : it.generationId,
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
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Campañas
      </Link>

      {planNotice && !planNoticeDismissed && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2.5 text-xs leading-snug text-muted-foreground"
        >
          <Info className="mt-0.5 size-3.5 shrink-0 text-amber-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-foreground">El plan salió genérico</p>
            <p className="mt-0.5">
              No pudimos interpretar tus ideas contra el catálogo, así que se armó un mix
              estándar. Revisa cada creativo en el plan o rehazlo desde «Nueva campaña».
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPlanNoticeDismissed(true)}
            className="shrink-0 rounded px-2 py-1 text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Entendido
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">{campaign.name}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {campaign.productName} · {items.length} creativos
            {campaign.creditsEstimated ? ` · ~${campaign.creditsEstimated} cr en borradores` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="default" size="sm">
            <Link href={`/app/campaigns/${campaign.id}/storyboard`}>
              <Clapperboard className="size-3.5" aria-hidden />
              Storyboard
            </Link>
          </Button>
          <span className="h-4 w-px bg-border/60" aria-hidden />
          <ReferencePoolDialog campaignId={campaign.id} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
            CSV
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/campaigns/${campaign.id}/report`}>
              <FileBarChart className="size-3.5" aria-hidden />
              Reporte
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => setSettingsOpen(true)}
            title="Ajustes de la campaña"
            aria-label="Ajustes de la campaña"
          >
            <Settings className="size-3.5" aria-hidden />
          </Button>
          <div
            role="tablist"
            aria-label="Vistas del studio"
            className="flex gap-1 rounded-lg border border-border bg-card p-0.5"
          >
            {STUDIO_TABS.map((t, idx) => (
              <button
                key={t}
                ref={(el) => { tabRefs.current[idx] = el; }}
                type="button"
                role="tab"
                id={`studio-tab-${t}`}
                aria-selected={tab === t}
                tabIndex={tab === t ? 0 : -1}
                onClick={() => setTab(t)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                className={`rounded-md px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
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

      <div className="mt-3">
        <ProductSizeEditor
          campaignId={campaign.id}
          initialHeightCm={campaign.productHeightCm}
          initialWidthCm={campaign.productWidthCm}
          initialMedium={campaign.productMedium}
          initialThicknessMm={campaign.productThicknessMm}
          initialWeightKg={campaign.productWeightKg}
        />
      </div>
      <div className="mt-3">
        <CreativeGuidelinesEditor campaignId={campaign.id} aspectRatio={campaign.aspectRatio} initial={campaign.guidelines} />
      </div>

      {tab === 'plan' ? (
        <>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { setReprocessIdea(campaign.ideaText ?? ''); setReprocessError(null); setReprocessDone(null); setReprocessOpen(true); }}
              title="Re-interpretar tu idea con IA y rehacer el plan"
            >
              <Wand2 className="size-3.5" aria-hidden />
              Reprocesar idea con IA
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/campaigns/${campaign.id}/refine/new`}>
                <Sparkles className="size-3.5" aria-hidden />
                Agregar creativo
              </Link>
            </Button>
          </div>
          <PlanTable
            campaignId={campaign.id}
            items={items}
            locationOptions={locationOptions}
            productPool={campaign.productPool}
            brandKitId={campaign.brandKitId}
            onEdit={setEditing}
            onPreview={handlePreviewPrompt}
            onDeleted={(id) => setItems((p) => p.filter((i) => i.id !== id))}
            onSequenceMerged={(sequenceId, merged) =>
              setItems((p) => [...p.filter((i) => i.sequenceId !== sequenceId), merged])
            }
            onSequenceLocationChanged={(sequenceId, locationId) =>
              setItems((p) =>
                p.map((i) => (i.sequenceId === sequenceId ? { ...i, locationId } : i)),
              )
            }
            onProductChanged={(itemId, productId) =>
              setItems((p) => p.map((i) => (i.id === itemId ? { ...i, productId } : i)))
            }
          />
        </>
      ) : tab === 'produccion' ? (
        <ProductionView
          campaignId={campaign.id}
          groups={byFormat}
          characterOptions={characterOptions}
          pricing={pricing}
          brandKitId={campaign.brandKitId}
          productPool={campaign.productPool}
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
        <TemplatesView
          templates={templates}
          onSeriesCreated={(created) => setItems((prev) => [...prev, ...created])}
        />
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
            // patch.status viene del server (autoritativo): no forzar 'planned'
            // aquí, así no se pisa una transición concurrente de realtime.
            setItems((prev) => prev.map((i) => (i.id === editing.id ? { ...i, ...patch } : i)));
            setEditing(null);
          }}
        />
      )}

      {promptPreview && (
        <PromptPreviewDialog preview={promptPreview} onClose={() => setPromptPreview(null)} />
      )}

      {settingsOpen && (
        <CampaignSettingsDialog campaign={campaign} onClose={() => setSettingsOpen(false)} />
      )}

      <Dialog open={reprocessOpen} onOpenChange={(o) => { if (!reprocessing) setReprocessOpen(o); }}>
        {/* flex-col + topes de alto: el Textarea base usa field-sizing-content
            (crece con el contenido, ignora rows) y una idea larga inflaba el
            modal más allá del viewport. El textarea y la lista de notas
            scrollean internos; header y botones quedan fijos. */}
        <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Reprocesar idea con IA</DialogTitle>
            <DialogDescription>
              La IA interpreta tu idea y rehace el plan. Reemplaza los creativos en borrador; los
              que ya generaste se conservan.
            </DialogDescription>
          </DialogHeader>
          {reprocessDone ? (
            <>
              <p className="text-xs text-foreground">
                Plan reprocesado: {reprocessDone.items} creativos · ~{reprocessDone.credits} cr en borradores.
              </p>
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                {reprocessDone.notes.map((n, i) => (
                  <li key={i} className="break-words text-2xs text-amber-400/90">{n}</li>
                ))}
              </ul>
              <div className="flex justify-end">
                <Button type="button" size="sm" onClick={() => window.location.reload()}>
                  Ver el plan nuevo
                </Button>
              </div>
            </>
          ) : (
            <>
              <Textarea
                value={reprocessIdea}
                onChange={(e) => setReprocessIdea(e.target.value)}
                disabled={reprocessing}
                rows={6}
                maxLength={6000}
                placeholder="Describe qué quieres ver: el producto, la acción concreta en pantalla, el tono. Una idea por línea si son varios anuncios."
                className="max-h-56 min-h-24 overflow-y-auto text-xs"
              />
              {reprocessError && (
                <p className="break-words text-2xs text-amber-400/90">{reprocessError}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={reprocessing}
                  onClick={() => setReprocessOpen(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={reprocessing || reprocessIdea.trim().length === 0}
                  onClick={handleReprocess}
                >
                  {reprocessing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Wand2 className="size-3.5" aria-hidden />}
                  Reprocesar
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

const GOAL_LABEL: Record<string, string> = {
  '': 'Sin objetivo',
  awareness: 'Reconocimiento',
  conversion: 'Conversión',
  mixed: 'Mixto',
};

function CampaignSettingsDialog({
  campaign,
  onClose,
}: {
  campaign: StudioCampaign;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(campaign.name);
  const [goal, setGoal] = useState(campaign.goal ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  async function handleSave() {
    setSaving(true);
    const res = await updateCampaignStudioAction({
      id: campaign.id,
      name: name.trim(),
      goal: goal ? (goal as 'awareness' | 'conversion' | 'mixed') : null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo guardar');
      return;
    }
    toast.success('Campaña actualizada');
    router.refresh();
    onClose();
  }

  async function handleStatus(status: 'delivered' | 'archived') {
    setSaving(true);
    const res = await setCampaignStatusAction({ id: campaign.id, status });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo actualizar el estado');
      return;
    }
    if (status === 'archived') {
      toast.success('Campaña archivada');
      router.push('/app/campaigns');
    } else {
      toast.success('Campaña marcada como entregada');
      router.refresh();
      onClose();
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajustes de la campaña</DialogTitle>
        </DialogHeader>

        <label htmlFor="campaign-name" className="block text-xs font-medium text-foreground/80">
          Nombre
        </label>
        <input
          id="campaign-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        />

        <label htmlFor="campaign-goal" className="mt-3 block text-xs font-medium text-foreground/80">
          Objetivo
        </label>
        <select
          id="campaign-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {Object.entries(GOAL_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || name.trim().length === 0}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Guardar
          </Button>
        </div>

        <div className="mt-4 space-y-2 border-t border-border/60 pt-4">
          <p className="text-2xs text-muted-foreground">Estado de la campaña</p>
          <div className="flex flex-wrap gap-2">
            {campaign.status !== 'delivered' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => handleStatus('delivered')}
                className="border-brand/40 text-brand hover:bg-brand/10"
              >
                <Trophy className="size-3.5" aria-hidden />
                Marcar como entregada
              </Button>
            )}
            {confirmArchive ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => handleStatus('archived')}
                className="border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/15"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Trash2 className="size-3.5" aria-hidden />}
                Confirmar archivar
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => setConfirmArchive(true)}
                className="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
              >
                <Trash2 className="size-3.5" aria-hidden />
                Archivar campaña
              </Button>
            )}
          </div>
          <p className="text-2xs text-muted-foreground">
            Archivar la saca de la lista de campañas y del dashboard. Sus creativos generados se conservan.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlanTable({
  campaignId,
  items,
  locationOptions,
  productPool,
  brandKitId,
  onEdit,
  onPreview,
  onDeleted,
  onSequenceMerged,
  onSequenceLocationChanged,
  onProductChanged,
}: {
  campaignId: string;
  items: StudioItem[];
  locationOptions: StudioLocationOption[];
  // V3 multi-producto (Fase 3): pool de la campaña y marca, para el selector
  // de producto por fila y su resalte cuando falta asignar.
  productPool: StudioProductPoolEntry[];
  brandKitId: string | null;
  onEdit: (item: StudioItem) => void;
  onPreview: (id: string) => void;
  onDeleted: (id: string) => void;
  onSequenceMerged: (sequenceId: string, merged: StudioItem) => void;
  onSequenceLocationChanged: (sequenceId: string, locationId: string | null) => void;
  onProductChanged: (itemId: string, productId: string | null) => void;
}) {
  const editable = (s: string) => ['planned', 'skipped', 'failed'].includes(s);
  const [generatingItem, setGeneratingItem] = useState<string | null>(null);
  const confirm = useConfirm();

  async function handleGenerateItem(item: StudioItem) {
    setGeneratingItem(item.id);
    const res = await generateItemAction(item.id);
    setGeneratingItem(null);
    if (!res.ok) {
      if (res.error === 'insufficient_credits') insufficientCreditsToast();
      else toast.error(res.message ?? 'No se pudo generar la escena');
      return;
    }
    toast.success('Escena en cola — aparecerá en Producción');
  }

  async function handleDelete(item: StudioItem) {
    const res = await deleteCampaignItemAction(item.id);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo eliminar');
      return;
    }
    onDeleted(item.id);
  }

  async function handleMergeSequence(sequenceId: string, sceneCount: number) {
    const ok = await confirm({
      title: '¿Unir la secuencia en un solo clip?',
      description: `Se combinarán las ${sceneCount} escenas en un único video continuo (máx 15s). Las escenas individuales se eliminan y esto no se puede deshacer.`,
      confirmLabel: 'Unir en 1 clip',
      destructive: true,
    });
    if (!ok) return;
    const res = await mergeSequenceAction({ sequenceId, campaignId });
    if (res.ok) {
      onSequenceMerged(sequenceId, res.data.item);
    } else {
      toast.error(res.message ?? 'No se pudo unir la secuencia');
    }
  }

  const [assigningLocation, setAssigningLocation] = useState<string | null>(null);
  const [assigningProduct, setAssigningProduct] = useState<string | null>(null);

  // V3 multi-producto (Fase 3): fija/limpia el producto de un clip. Actualiza el
  // estado local vía onProductChanged (no router.refresh — items vive en un
  // useState del padre sembrado una vez con initialItems, así que un refresh de
  // servidor no lo re-sincroniza; mismo motivo por el que assignSequenceLocationAction
  // usa un callback en vez de refrescar).
  async function handleAssignProduct(itemId: string, productId: string | null) {
    setAssigningProduct(itemId);
    const res = await setItemProductAction({ itemId, productId });
    setAssigningProduct(null);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo asignar el producto');
      return;
    }
    onProductChanged(itemId, productId);
  }

  async function handleAssignLocation(sequenceId: string, locationId: string | null) {
    setAssigningLocation(sequenceId);
    const res = await assignSequenceLocationAction(campaignId, sequenceId, locationId);
    setAssigningLocation(null);
    if (!res.ok) {
      toast.error('No se pudo asignar la locación');
      return;
    }
    onSequenceLocationChanged(sequenceId, locationId);
  }

  // V3 multi-producto (Fase 3): selector de producto por clip, compartido entre
  // renderPlanRow (clips sueltos) y las filas de escena de una secuencia. Solo
  // se muestra si la campaña tiene pool; sin pool no hay nada que asignar.
  const NO_PRODUCT = '__none__';
  function renderProductSelector(item: StudioItem) {
    if (productPool.length === 0) return null;
    const unassigned = !item.productId && !!brandKitId;
    return (
      <div className="mt-1 whitespace-normal">
        <Select
          value={item.productId ?? NO_PRODUCT}
          onValueChange={(v) => handleAssignProduct(item.id, v === NO_PRODUCT ? null : v)}
          disabled={assigningProduct === item.id}
        >
          <SelectTrigger
            size="sm"
            aria-label="Producto del clip"
            className={cn(
              'h-6 w-full max-w-[10rem] px-2 text-2xs',
              unassigned && 'border-amber-500/50 text-amber-500',
            )}
          >
            <SelectValue placeholder="Sin asignar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PRODUCT}>Sin asignar</SelectItem>
            {productPool.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {unassigned && <p className="mt-0.5 text-2xs text-amber-500">Sin asignar</p>}
      </div>
    );
  }

  function renderPlanRow(item: StudioItem) {
    const unassigned = productPool.length > 0 && !item.productId && !!brandKitId;
    return (
      <tr
        key={item.id}
        className={cn(
          'border-b border-border/50 last:border-0',
          unassigned && 'bg-amber-500/[0.05]',
        )}
      >
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
            <span className="ml-1.5 rounded-full border border-primary/40 px-1.5 py-0.5 text-2xs text-primary">
              serie
            </span>
          )}
          {item.characterNames.length > 0 && (
            <span className="ml-1.5 text-2xs text-muted-foreground">
              · {item.characterNames.join(' + ')}
            </span>
          )}
          {renderProductSelector(item)}
        </td>
        <td className="hidden max-w-md px-3 py-2.5 md:table-cell">
          {item.scene && (
            <p className="line-clamp-1 text-2xs text-muted-foreground">{item.scene}</p>
          )}
          <p className="line-clamp-2 text-muted-foreground/80">
            {item.sceneSummary ?? item.scenePrompt}
          </p>
          {item.caption && (
            <p className="mt-0.5 line-clamp-1 text-2xs text-muted-foreground">
              Caption: {item.caption}
            </p>
          )}
          {item.warnings.length > 0 && (
            <p className="mt-0.5 line-clamp-1 text-2xs text-amber-400/70">
              {item.warnings[0]}
              {item.warnings.length > 1 ? ` +${item.warnings.length - 1}` : ''}
            </p>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5">
          <StatusBadge status={item.status} />
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right">
          <span className="inline-flex gap-1">
            {editable(item.status) && (
              <>
                <button
                  type="button"
                  onClick={() => handleGenerateItem(item)}
                  disabled={generatingItem === item.id || unassigned}
                  title={unassigned ? 'Asigna un producto a este clip antes de generar' : 'Generar esta escena'}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-2xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  {generatingItem === item.id ? (
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                  ) : (
                    <Play className="size-3" aria-hidden />
                  )}
                  Generar
                </button>
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
  const singleGroups = groups.filter(
    (g): g is Extract<typeof g, { kind: 'single' }> => g.kind === 'single',
  );
  const singleCount = singleGroups.length;

  return (
    <div className="mt-5 space-y-3">
      {sequenceGroups.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/[0.06] px-3 py-2.5 text-xs leading-snug text-muted-foreground">
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
      {singleGroups.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-muted/20 text-2xs uppercase tracking-wide text-muted-foreground/60">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
                <th scope="col" className="px-3 py-2 font-medium">Formato</th>
                <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">Escena / acción</th>
                <th scope="col" className="px-3 py-2 font-medium">Estado</th>
                <th scope="col" className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>{singleGroups.map((group) => renderPlanRow(group.item))}</tbody>
          </table>
        </div>
      )}
      {sequenceGroups.map((group) => (
          <div key={group.sequenceId} className="rounded-xl border border-border bg-card/40 p-3">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-2sm font-medium text-foreground">
                  <Layers className="size-3.5 text-primary" aria-hidden />
                  Secuencia{group.label ? `: «${group.label}»` : ''} · {group.scenes.length} escenas
                  <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-2xs uppercase tracking-wide text-primary">
                    sugerida por IA
                  </span>
                </div>
                <p className="mt-1 text-2xs leading-snug text-muted-foreground">
                  La IA dividió esta idea en {group.scenes.length} escenas que se generan por
                  separado y juntas forman un anuncio.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {locationOptions.length > 0 && (
                  <select
                    aria-label="Locación de la secuencia"
                    disabled={assigningLocation === group.sequenceId}
                    value={group.scenes[0]?.locationId ?? ''}
                    onChange={(e) =>
                      handleAssignLocation(group.sequenceId, e.target.value === '' ? null : e.target.value)
                    }
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-2xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                  >
                    <option value="">Sin locación</option>
                    {locationOptions.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  title={`Une las ${group.scenes.length} escenas en un solo video continuo (máx 15s). Si no las unes, se generan por separado.`}
                  className="rounded-md border border-border px-2.5 py-1.5 text-2xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => handleMergeSequence(group.sequenceId, group.scenes.length)}
                >
                  Unir en 1 clip
                </button>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-muted/20 text-2xs uppercase tracking-wide text-muted-foreground/60">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">#</th>
                    <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
                    <th scope="col" className="px-3 py-2 font-medium">Formato</th>
                    <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">Escena / acción</th>
                    <th scope="col" className="px-3 py-2 font-medium">Estado</th>
                    <th scope="col" className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {group.scenes.map((scene, i) => {
                    const sceneUnassigned = productPool.length > 0 && !scene.productId && !!brandKitId;
                    return (
                    <tr
                      key={scene.id}
                      className={cn(
                        'border-b border-border/50 last:border-0',
                        sceneUnassigned && 'bg-amber-500/[0.05]',
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 text-2xs text-muted-foreground">{i + 1}</td>
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
                          <span className="ml-1.5 rounded-full border border-primary/40 px-1.5 py-0.5 text-2xs text-primary">
                            serie
                          </span>
                        )}
                        {scene.characterNames.length > 0 && (
                          <span className="ml-1.5 text-2xs text-muted-foreground">
                            · {scene.characterNames.join(' + ')}
                          </span>
                        )}
                        {renderProductSelector(scene)}
                      </td>
                      <td className="hidden max-w-md px-3 py-2.5 md:table-cell">
                        {scene.scene && (
                          <p className="line-clamp-1 text-2xs text-muted-foreground">{scene.scene}</p>
                        )}
                        <p className="line-clamp-2 text-muted-foreground/80">
                          {scene.sceneSummary ?? scene.scenePrompt}
                        </p>
                        {scene.caption && (
                          <p className="mt-0.5 line-clamp-1 text-2xs text-muted-foreground">
                            Caption: {scene.caption}
                          </p>
                        )}
                        {scene.warnings.length > 0 && (
                          <p className="mt-0.5 line-clamp-1 text-2xs text-amber-400/70">{scene.warnings[0]}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <StatusBadge status={scene.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <span className="inline-flex gap-1">
                          {editable(scene.status) && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleGenerateItem(scene)}
                                disabled={generatingItem === scene.id || sceneUnassigned}
                                title={
                                  sceneUnassigned
                                    ? 'Asigna un producto a este clip antes de generar'
                                    : 'Generar esta escena (continúa desde la anterior)'
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-2xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                              >
                                {generatingItem === scene.id ? (
                                  <Loader2 className="size-3 animate-spin" aria-hidden />
                                ) : (
                                  <Play className="size-3" aria-hidden />
                                )}
                                Generar
                              </button>
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
      ))}
    </div>
  );
}

function ProductionView({
  campaignId,
  groups,
  characterOptions,
  pricing,
  brandKitId,
  productPool,
  onWinner,
  onSamplesReset,
}: {
  campaignId: string;
  groups: Array<{ formatId: string; formatName: string; items: StudioItem[] }>;
  characterOptions: StudioCharacterOption[];
  pricing: PricingRow[];
  // V3 multi-producto (Fase 3, Task 5): gating de "Muestra"/"Lote completo" —
  // mismo cálculo que el resalte de PlanTable, aplicado a nivel de grupo.
  brandKitId: string | null;
  productPool: StudioProductPoolEntry[];
  onWinner: (itemId: string, isWinner: boolean) => void;
  onSamplesReset: (formatId: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  // Costo del render final por item (Seedance, per-segundo según resolución). null si
  // falta el pricing -> el botón cae a solo la etiqueta de resolución.
  const finalCost = (resolution: '720p' | '1080p', durationS: number | null): number | null => {
    try {
      return seedanceCostPerItem(pricing, FINAL_MODEL, resolution, durationS ?? 8);
    } catch {
      return null;
    }
  };
  const [distilling, setDistilling] = useState<StudioItem | null>(null);
  const [varianting, setVarianting] = useState<StudioItem | null>(null);
  // Visor inline del creativo generado (evita ir a la Biblioteca).
  const [viewing, setViewing] = useState<{ generationId: string; title: string; filename: string } | null>(null);

  // Descarga masiva: todos los videos terminados de la campaña, secuencial (el
  // fetch del blob ya espacia los saves; un zip en RAM con N videos es riesgo).
  // El navegador pide permiso de "descargas múltiples" en la primera.
  const downloadable = groups
    .flatMap((g) => g.items)
    .filter((i) => i.generationId != null && ['draft_ready', 'final_ready'].includes(i.status));
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  async function handleDownloadAll() {
    setDownloadingAll(true);
    let ok = 0;
    let failed = 0;
    try {
      for (const [idx, item] of downloadable.entries()) {
        setDownloadProgress(idx + 1);
        try {
          const res = await fetch(`/api/generations/${item.generationId}`, { cache: 'no-store' });
          const d = res.ok ? ((await res.json()) as { outputUrl: string | null }) : null;
          if (!d?.outputUrl) {
            failed++;
            continue;
          }
          await downloadFile(
            d.outputUrl,
            clipDownloadName({
              sequenceId: item.sequenceId,
              sceneIndex: item.sceneIndex,
              generationId: item.generationId as string,
            }),
          );
          ok++;
        } catch {
          failed++;
        }
      }
    } finally {
      setDownloadingAll(false);
      setDownloadProgress(0);
    }
    if (failed > 0) toast.error(`${ok} videos descargados · ${failed} fallaron`);
    else toast.success(`${ok} video${ok === 1 ? '' : 's'} descargado${ok === 1 ? '' : 's'}`);
  }

  async function handleCancel(generationId: string) {
    setBusy(`cancel:${generationId}`);
    const res = await cancelGenerationAction(generationId);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo cancelar');
      return;
    }
    toast.success('Cancelando la generación — se libera el crédito reservado al detenerse');
  }

  async function handleRegenerate(itemId: string, mode: RegenMode = 'auto') {
    setBusy(`regen:${itemId}`);
    const res = await generateItemAction(itemId, mode);
    setBusy(null);
    if (!res.ok) {
      if (res.error === 'insufficient_credits') insufficientCreditsToast();
      else toast.error(res.message ?? 'No se pudo regenerar la escena');
      return;
    }
    toast.success(
      mode === 'this-and-forward'
        ? 'Regenerando este clip y los siguientes en cadena'
        : 'Regenerando la escena — reemplazará el borrador al terminar',
    );
  }

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

  async function handleFinal(itemId: string, resolution: '720p' | '1080p') {
    setBusy(`final:${itemId}:${resolution}`);
    const res = await requestFinalAction({ itemId, resolution });
    setBusy(null);
    if (!res.ok) {
      if (res.error === 'insufficient_credits') insufficientCreditsToast();
      else toast.error(res.message ?? 'No se pudo encolar el final');
      return;
    }
    toast.success(`Versión final en cola (${resolution}, misma composición)`);
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
      {downloadable.length > 0 && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={downloadingAll}
            onClick={handleDownloadAll}
            title="Descarga cada video con su número de clip (clip-01, clip-02, …)"
          >
            {downloadingAll ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="size-3.5" aria-hidden />
            )}
            {downloadingAll
              ? `Descargando ${downloadProgress}/${downloadable.length}…`
              : `Descargar todos (${downloadable.length})`}
          </Button>
        </div>
      )}
      {groups.map((group) => {
        const pending = group.items.filter((i) => ['planned', 'failed'].includes(i.status)).length;
        const generatingItems = group.items.filter((i) => ['sample', 'queued', 'approved'].includes(i.status));
        const generating = generatingItems.length;
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
        // V3 multi-producto (Fase 3, Task 5): mismo cálculo que el resalte "Sin
        // asignar" de PlanTable, a nivel de grupo — si algún clip del formato no
        // tiene producto (campaña con marca+pool), no se puede encolar el lote.
        const groupUnassigned =
          !!brandKitId && productPool.length > 0 && group.items.some((i) => !i.productId);
        return (
          <div key={group.formatId || group.formatName} className="rounded-xl border border-border bg-card/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="grid size-8 place-items-center rounded-lg bg-muted/40">
                  <Clapperboard className="size-4 text-muted-foreground" aria-hidden />
                </div>
                <div title={group.items[0]?.formatDescription || undefined}>
                  <p className="text-[13.5px] font-medium text-foreground">{group.formatName}</p>
                  <p className="text-2xs text-muted-foreground">
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
                        className="mt-1 flex items-center gap-1.5 text-2xs text-muted-foreground/80"
                      >
                        <Layers className="size-3 text-primary/70" aria-hidden />
                        Secuencia{label ? ` «${label}»` : ''}: {n} escenas en orden
                      </p>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending === 0 || busy !== null || pureSequence || groupUnassigned}
                  title={
                    groupUnassigned
                      ? 'Asigna un producto a cada clip antes de generar'
                      : pureSequence
                        ? 'Una secuencia se genera completa y en orden: usa «Lote completo».'
                        : undefined
                  }
                  onClick={() => handleBatch(group.formatId, 'sample')}
                >
                  {busy === `${group.formatId}:sample` ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Play className="size-3.5" aria-hidden />
                  )}
                  Muestra (2)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending === 0 || busy !== null || groupUnassigned}
                  title={groupUnassigned ? 'Asigna un producto a cada clip antes de generar' : undefined}
                  onClick={() => handleBatch(group.formatId, 'full')}
                >
                  {busy === `${group.formatId}:full` ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Play className="size-3.5" aria-hidden />
                  )}
                  Lote completo
                </Button>
              </div>
            </div>

            {groupUnassigned && (
              <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-2 text-2xs leading-snug text-amber-300/90">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>Hay clips sin producto asignado — asígnalos en el Plan antes de generar.</span>
              </p>
            )}

            {sequences.length > 0 && pending > 0 && (
              <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-2 text-2xs leading-snug text-amber-300/90">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  {pureSequence
                    ? 'Una secuencia se genera completa y en orden. «Lote completo» encola las escenas del anuncio.'
                    : '«Muestra (2)» aplica solo a los clips sueltos; la secuencia se genera completa con «Lote completo».'}
                </span>
              </p>
            )}

            {generatingItems.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
                {generatingItems.map((g) => (
                  <div key={g.id} className="flex items-center justify-between gap-3 text-xs">
                    <p className="line-clamp-1 flex-1 text-muted-foreground">
                      <Loader2 className="mr-1.5 inline size-3 animate-spin align-[-2px]" aria-hidden />
                      {g.sceneSummary ?? g.scenePrompt}
                    </p>
                    {g.generationId && (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={busy !== null}
                        onClick={() => handleCancel(g.generationId as string)}
                        title="Cancelar esta generación (libera el crédito reservado)"
                        className="shrink-0 hover:border-destructive/40 hover:text-destructive"
                      >
                        {busy === `cancel:${g.generationId}` ? (
                          <Loader2 className="size-3 animate-spin" aria-hidden />
                        ) : (
                          <X className="size-3" aria-hidden />
                        )}
                        Cancelar
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {drafts.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
                {drafts.map((d) => {
                  const seqGroup = group.items.filter(
                    (i) => i.sequenceId != null && i.sequenceId === d.sequenceId,
                  );
                  const modes =
                    d.sequenceId != null && d.sceneIndex != null
                      ? regenModesFor(
                          seqGroup.map((i) => ({ id: i.id, sceneIndex: i.sceneIndex as number })),
                          d.sceneIndex,
                        )
                      : { onlyThis: false, thisAndForward: false };
                  const isSeqMiddle = modes.onlyThis || modes.thisAndForward;
                  return (
                    <div key={d.id} className="flex items-center justify-between gap-3 text-xs">
                      <p className="line-clamp-1 flex-1 text-muted-foreground/80">
                        {d.sceneSummary ?? d.scenePrompt}
                      </p>
                      <span className="flex shrink-0 gap-1.5">
                        {d.generationId && (
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() =>
                              setViewing({
                                generationId: d.generationId as string,
                                title: d.sceneSummary ?? d.scenePrompt,
                                filename: clipDownloadName({
                                  sequenceId: d.sequenceId,
                                  sceneIndex: d.sceneIndex,
                                  generationId: d.generationId as string,
                                }),
                              })
                            }
                          >
                            <Play className="size-3" aria-hidden />
                            Ver
                          </Button>
                        )}
                        <Button asChild variant="outline" size="xs">
                          <Link
                            href={`/app/campaigns/${campaignId}/refine/${d.id}`}
                            title="Refinar el prompt con el asistente"
                            className="hover:text-primary"
                          >
                            <Sparkles className="size-3" aria-hidden />
                            Refinar
                          </Link>
                        </Button>
                        {isSeqMiddle ? (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              disabled={busy !== null}
                              onClick={() => handleRegenerate(d.id, 'only-this')}
                              title="Rehace solo este clip, conservando los vecinos (lo ancla al inicio del siguiente)"
                            >
                              {busy === `regen:${d.id}` ? (
                                <Loader2 className="size-3 animate-spin" aria-hidden />
                              ) : (
                                <RefreshCw className="size-3" aria-hidden />
                              )}
                              Regenerar solo este
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              disabled={busy !== null}
                              onClick={() => handleRegenerate(d.id, 'this-and-forward')}
                              title="Rehace este clip y vuelve a encadenar los siguientes"
                            >
                              Este y los siguientes
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled={busy !== null}
                            onClick={() => handleRegenerate(d.id)}
                            title="Regenerar esta escena (reemplaza el borrador)"
                          >
                            {busy === `regen:${d.id}` ? (
                              <Loader2 className="size-3 animate-spin" aria-hidden />
                            ) : (
                              <RefreshCw className="size-3" aria-hidden />
                            )}
                            Regenerar
                          </Button>
                        )}
                        <span
                          className="inline-flex shrink-0 items-center overflow-hidden rounded-lg border border-brand/40 text-2xs"
                          title="Aprobar y renderizar la versión final con la misma composición"
                        >
                          <span className="px-2 py-1 text-brand/70">Final</span>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => handleFinal(d.id, '720p')}
                            className="border-l border-brand/30 px-2 py-1 text-brand transition-colors hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40"
                          >
                            {busy === `final:${d.id}:720p`
                              ? '…'
                              : finalCost('720p', d.durationS) != null
                                ? `720p · −${finalCost('720p', d.durationS)} cr`
                                : '720p'}
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => handleFinal(d.id, '1080p')}
                            className="border-l border-brand/30 px-2 py-1 text-brand transition-colors hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40"
                          >
                            {busy === `final:${d.id}:1080p`
                              ? '…'
                              : finalCost('1080p', d.durationS) != null
                                ? `1080p · −${finalCost('1080p', d.durationS)} cr`
                                : '1080p'}
                          </button>
                        </span>
                      </span>
                    </div>
                  );
                })}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => handleRedoSamples(group.formatId)}
                  className="mt-1 text-2xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-40"
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
                  <div key={f.id} className="flex items-center justify-between gap-3 text-xs">
                    <p className="line-clamp-1 flex-1 text-muted-foreground/80">
                      {f.sceneSummary ?? f.scenePrompt}
                    </p>
                    <span className="flex shrink-0 gap-1.5">
                      {f.generationId && (
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() =>
                            setViewing({
                              generationId: f.generationId as string,
                              title: f.sceneSummary ?? f.scenePrompt,
                              filename: clipDownloadName({
                                sequenceId: f.sequenceId,
                                sceneIndex: f.sceneIndex,
                                generationId: f.generationId as string,
                              }),
                            })
                          }
                        >
                          <Play className="size-3" aria-hidden />
                          Ver
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={busy !== null}
                        onClick={() => handleWinner(f)}
                        title={
                          f.isWinner
                            ? 'Quitar la marca de ganador'
                            : 'Marcar como ganador: prioriza este formato en próximas campañas'
                        }
                        className={
                          f.isWinner
                            ? 'border-amber-400/50 bg-amber-400/10 text-amber-300 hover:bg-amber-400/15'
                            : ''
                        }
                      >
                        <Trophy className="size-3" aria-hidden />
                        {f.isWinner ? 'Ganador' : 'Marcar ganador'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={!f.generationId}
                        onClick={() => setDistilling(f)}
                      >
                        Convertir en plantilla
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={!f.generationId}
                        onClick={() => setVarianting(f)}
                      >
                        Variante
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <ImagePackCard campaignId={campaignId} pricing={pricing} />

      <p className="text-2xs text-muted-foreground">
        Los lotes se encolan escalonados (20 s entre videos). Cuando un creativo termina, ábrelo con
        &ldquo;Ver&rdquo; aquí mismo; el borrador se genera en 480p y la versión final en 720p o 1080p, según elijas, con la misma composición.
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
          filename={viewing.filename}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function TemplatesView({
  templates,
  onSeriesCreated,
}: {
  templates: StudioTemplate[];
  onSeriesCreated: (created: StudioItem[]) => void;
}) {
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
    // El canal realtime solo escucha UPDATE: agregar los items nuevos al estado
    // para que aparezcan sin recargar (evita el re-click que duplicaba la serie).
    onSeriesCreated(res.data.created);
    toast.success(`Serie creada: ${res.data.items} items en el plan — apruébalos desde Producción`);
  }

  if (templates.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-center gap-2 text-center text-muted-foreground/60">
        <p className="text-sm text-foreground/70">Sin plantillas todavía</p>
        <p className="max-w-md text-xs">
          Cuando un creativo final te funcione, conviértelo en plantilla desde Producción: su estructura,
          cámara y ritmo quedan fijos y puedes generar series rotando escena y personaje.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/50 p-3 text-xs">
        <span className="text-muted-foreground">Tamaño de la serie:</span>
        {[2, 3, 4, 6].map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={count === n}
            aria-label={`Tamaño de la serie: ${n}`}
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
              <p className="text-2xs text-muted-foreground">
                {t.formatName} · usada {t.usesCount} {t.usesCount === 1 ? 'vez' : 'veces'}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={busy !== null}
              onClick={() => handleSeries(t.id)}
              className="shrink-0"
            >
              {busy === t.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
              Generar serie ({count})
            </Button>
          </div>
        ))}
      </div>
      <p className="text-2xs text-muted-foreground">
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
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleDistill}
            disabled={saving || name.trim().length === 0}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Crear plantilla
          </Button>
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

        <div
          role="radiogroup"
          aria-label="Tipo de variante"
          className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-background p-0.5"
        >
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
              role="radio"
              aria-checked={mode === m.value}
              onClick={() => setMode(m.value)}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
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
              <span className="text-xs font-medium text-foreground/80">Segundos a extender</span>
              <div className="mt-1.5 flex gap-2">
                {[4, 5, 6, 8].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setExtendSeconds(s)}
                    className={`flex-1 rounded-lg border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
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
              <label htmlFor="variant-cont" className="text-xs font-medium text-foreground/80">
                Qué pasa en la continuación (opcional)
              </label>
              <textarea
                id="variant-cont"
                value={continuation}
                onChange={(e) => setContinuation(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="She sets the can down and looks back to camera with a smile"
                className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
          </div>
        ) : mode === 'replace_character' ? (
          <div className="mt-4">
            <label htmlFor="variant-char" className="text-xs font-medium text-foreground/80">
              Nuevo personaje (acciones, escena y cámara se conservan)
            </label>
            {characterOptions.length === 0 ? (
              <p className="mt-1.5 text-xs text-amber-400/80">No hay personajes en el Cast.</p>
            ) : (
              <select
                id="variant-char"
                value={characterId}
                onChange={(e) => setCharacterId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
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
            <label htmlFor="variant-action" className="text-xs font-medium text-foreground/80">
              Nueva acción o desenlace (sujeto, escena y cámara se conservan)
            </label>
            <textarea
              id="variant-action"
              value={newAction}
              onChange={(e) => setNewAction(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="She opens the can, takes a sip and raises it toward the camera"
              className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="variant-bridge" className="text-xs font-medium text-foreground/80">
                Clip destino (el puente conecta el final de este clip con su inicio)
              </label>
              {bridgeOptions.length === 0 ? (
                <p className="mt-1.5 text-xs text-amber-400/80">
                  Necesitas otro final terminado en la campaña para conectar.
                </p>
              ) : (
                <select
                  id="variant-bridge"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
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
              <span className="text-xs font-medium text-foreground/80">Duración del puente</span>
              <div className="mt-1.5 flex gap-2">
                {[4, 5, 6, 8].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setBridgeSeconds(s)}
                    className={`flex-1 rounded-lg border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
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
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={saving || !canSubmit}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Encolar variante
          </Button>
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
  const [characterStateHint, setCharacterStateHint] = useState<string | null>(item.characterStateHint);
  // Vestuario (specs/v2/16): override por clip, mismo patrón que characterStateHint.
  const [characterOutfitHint, setCharacterOutfitHint] = useState<string | null>(item.characterOutfitHint);
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
      ...(characterStateHint !== item.characterStateHint ? { characterStateHint } : {}),
      ...(characterOutfitHint !== item.characterOutfitHint ? { characterOutfitHint } : {}),
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
      characterStateHint,
      characterOutfitHint,
      // Estado autoritativo del server: 'planned' si se tocó producción, o el
      // estado real conservado para ediciones de solo caption/fecha.
      status: res.data.status,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar creativo · {item.formatName}</DialogTitle>
        </DialogHeader>

        <label htmlFor="edit-prompt" className="block text-xs font-medium text-foreground/80">
          Acción de la escena
        </label>
        <textarea
          id="edit-prompt"
          value={scenePrompt}
          onChange={(e) => setScenePrompt(e.target.value)}
          rows={4}
          maxLength={4000}
          className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="edit-scene" className="block text-xs font-medium text-foreground/80">
              Escena (fragmento de contexto)
            </label>
            <input
              id="edit-scene"
              value={scene}
              onChange={(e) => setScene(e.target.value)}
              maxLength={200}
              placeholder="a sunlit home kitchen"
              className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <label htmlFor="edit-character" className="block text-xs font-medium text-foreground/80">
              Personaje
            </label>
            <select
              id="edit-character"
              value={characterId}
              onChange={(e) => setCharacterId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="">Sin cambio / sin personaje</option>
              {characterOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {(() => {
            const states = characterOptions.find((c) => c.id === characterId)?.states ?? [];
            if (states.length === 0) return null;
            return (
              <div>
                <label htmlFor="edit-state" className="block text-xs font-medium text-foreground/80">
                  Estado del personaje
                </label>
                <select
                  id="edit-state"
                  value={characterStateHint ?? ''}
                  onChange={(e) => setCharacterStateHint(e.target.value || null)}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">Ninguno (neutral)</option>
                  {states.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            );
          })()}
          {(() => {
            const outfits = characterOptions.find((c) => c.id === characterId)?.outfits ?? [];
            if (outfits.length === 0) return null;
            return (
              <div>
                <label htmlFor="edit-outfit" className="block text-xs font-medium text-foreground/80">
                  Vestuario
                </label>
                <select
                  id="edit-outfit"
                  value={characterOutfitHint ?? ''}
                  onChange={(e) => setCharacterOutfitHint(e.target.value || null)}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">El de campaña (o base)</option>
                  {outfits.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            );
          })()}
        </div>

        <label htmlFor="edit-caption" className="mt-3 block text-xs font-medium text-foreground/80">
          Caption de publicación
        </label>
        <textarea
          id="edit-caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={2}
          maxLength={2200}
          placeholder="Texto que acompaña al post; va al export, nunca dentro del video"
          className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        />

        <label htmlFor="edit-date" className="mt-3 block text-xs font-medium text-foreground/80">
          Fecha programada
        </label>
        <input
          id="edit-date"
          type="date"
          value={scheduledDate}
          onChange={(e) => setScheduledDate(e.target.value)}
          className="mt-1.5 rounded-lg border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        />

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || scenePrompt.trim().length === 0}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Guardar
          </Button>
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
          <div className="flex items-center gap-2 py-6 text-2sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Compilando…
          </div>
        ) : preview.errors.length > 0 ? (
          <div className="space-y-1 text-xs text-red-300/90">
            {preview.errors.map((e) => (
              <p key={e}>{e}</p>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-3 text-xs leading-relaxed text-foreground/90">
              {preview.prompt}
            </pre>
            {preview.references.length > 0 && (
              <div className="text-2xs text-muted-foreground">
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
              <div className="text-2xs text-amber-300/80">
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
