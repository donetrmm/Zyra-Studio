'use client';

import { useState } from 'react';
import { Info, Layers } from 'lucide-react';
import { toast } from 'sonner';
import {
  assignSequenceLocationAction,
  deleteCampaignItemAction,
  generateItemAction,
  mergeSequenceAction,
} from '@/server-actions/campaigns';
import { groupPlanItems } from '@/lib/campaigns/plan-grouping';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { insufficientCreditsToast } from '../credits-toast';
import { PlanRow } from './PlanRow';
import type { StudioItem, StudioLocationOption } from './types';

export function PlanTable({
  campaignId,
  items,
  locationOptions,
  onEdit,
  onPreview,
  onDeleted,
  onSequenceMerged,
  onSequenceLocationChanged,
}: {
  campaignId: string;
  items: StudioItem[];
  locationOptions: StudioLocationOption[];
  onEdit: (item: StudioItem) => void;
  onPreview: (id: string) => void;
  onDeleted: (id: string) => void;
  onSequenceMerged: (sequenceId: string, merged: StudioItem) => void;
  onSequenceLocationChanged: (sequenceId: string, locationId: string | null) => void;
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
      toast.error('No se pudo eliminar');
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
            <tbody>
              {singleGroups.map((group) => (
                <PlanRow
                  key={group.item.id}
                  item={group.item}
                  campaignId={campaignId}
                  editable={editable(group.item.status)}
                  generating={generatingItem === group.item.id}
                  generateTitle="Generar esta escena"
                  onGenerate={handleGenerateItem}
                  onEdit={onEdit}
                  onPreview={onPreview}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
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
                  {group.scenes.map((scene, i) => (
                    <PlanRow
                      key={scene.id}
                      item={scene}
                      campaignId={campaignId}
                      sceneNumber={i + 1}
                      editable={editable(scene.status)}
                      generating={generatingItem === scene.id}
                      generateTitle="Generar esta escena (continúa desde la anterior)"
                      onGenerate={handleGenerateItem}
                      onEdit={onEdit}
                      onPreview={onPreview}
                      onDelete={handleDelete}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
      ))}
    </div>
  );
}
