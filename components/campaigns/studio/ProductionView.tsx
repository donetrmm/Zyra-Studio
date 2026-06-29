'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { cancelGenerationAction } from '@/server-actions/generations';
import {
  approveBatchAction,
  generateItemAction,
  redoSamplesAction,
  requestFinalAction,
  toggleWinnerAction,
  type RegenMode,
} from '@/server-actions/campaigns';
import { seedanceCostPerItem } from '@/lib/campaigns/estimate';
import type { PricingRow } from '@/lib/credits/types';
import { ImagePackCard } from '../CampaignCalendar';
import { GenerationViewer } from '../GenerationViewer';
import { insufficientCreditsToast } from '../credits-toast';
import { ProductionGroupCard } from './ProductionGroupCard';
import { DistillDialog } from './dialogs/DistillDialog';
import { VariantDialog } from './dialogs/VariantDialog';
import { FINAL_MODEL, type StudioItem, type StudioCharacterOption } from './types';

export function ProductionView({
  campaignId,
  groups,
  characterOptions,
  pricing,
  onWinner,
  onSamplesReset,
}: {
  campaignId: string;
  groups: Array<{ formatId: string; formatName: string; items: StudioItem[] }>;
  characterOptions: StudioCharacterOption[];
  pricing: PricingRow[];
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
  const [viewing, setViewing] = useState<{ generationId: string; title: string } | null>(null);

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
      {groups.map((group) => (
        <ProductionGroupCard
          key={group.formatId || group.formatName}
          group={group}
          campaignId={campaignId}
          busy={busy}
          finalCost={finalCost}
          onCancel={handleCancel}
          onRegenerate={handleRegenerate}
          onBatch={handleBatch}
          onFinal={handleFinal}
          onRedoSamples={handleRedoSamples}
          onWinner={handleWinner}
          onView={setViewing}
          onDistill={setDistilling}
          onVariant={setVarianting}
        />
      ))}
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
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
