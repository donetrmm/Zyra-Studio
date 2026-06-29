'use client';

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Clapperboard,
  Download,
  FileBarChart,
  Info,
  Loader2,
  Settings,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  exportCampaignCsvAction,
  generatePlanAction,
  previewItemPromptAction,
} from '@/server-actions/campaigns';
import { groupItemsByFormat, buildReprocessNotes } from '@/lib/campaigns/studio-view';
import { MATCHER_ERROR_HINTS } from '@/lib/campaigns/matcher-hints';
import type { PricingRow } from '@/lib/credits/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { CalendarView } from '../CampaignCalendar';

import { useCampaignItemsRealtime } from './use-campaign-items-realtime';
import { PlanTable } from './PlanTable';
import { ProductionView } from './ProductionView';
import {
  STUDIO_TABS,
  type StudioTemplate,
  type StudioCharacterOption,
  type StudioLocationOption,
  type StudioCampaign,
  type StudioItem,
} from './types';
import { TemplatesView } from './TemplatesView';
import { CampaignSettingsDialog } from './dialogs/CampaignSettingsDialog';
import { EditItemDialog } from './dialogs/EditItemDialog';
import { PromptPreviewDialog } from './dialogs/PromptPreviewDialog';

// Tipos y constantes viven en ./types; se re-exportan para no romper imports existentes.
export type { StudioItem, StudioTemplate, StudioCharacterOption, StudioLocationOption, StudioCampaign } from './types';

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
    const notes = buildReprocessNotes(res.data);
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
  useCampaignItemsRealtime(campaign.id, (r) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === r.id
          ? {
              ...it,
              status: r.status,
              warnings: r.warnings ?? it.warnings,
              generationId: r.generation_id !== undefined ? r.generation_id : it.generationId,
            }
          : it,
      ),
    );
  });

  const byFormat = useMemo(() => groupItemsByFormat(items), [items]);

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
          />
        </>
      ) : tab === 'produccion' ? (
        <ProductionView
          campaignId={campaign.id}
          groups={byFormat}
          characterOptions={characterOptions}
          pricing={pricing}
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
        <DialogContent className="sm:max-w-lg">
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
              <ul className="space-y-1">
                {reprocessDone.notes.map((n, i) => (
                  <li key={i} className="text-2xs text-amber-400/90">{n}</li>
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
                className="text-xs"
              />
              {reprocessError && (
                <p className="text-2xs text-amber-400/90">{reprocessError}</p>
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


