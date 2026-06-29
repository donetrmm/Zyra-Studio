'use client';

import type { StudioItem } from './types';
import type { RegenMode } from '@/server-actions/campaigns';
import { regenModesFor } from '@/lib/campaigns/sequence-chain';
import {
  Clapperboard,
  Info,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export function ProductionGroupCard({
  group,
  campaignId,
  busy,
  finalCost,
  onCancel,
  onRegenerate,
  onBatch,
  onFinal,
  onRedoSamples,
  onWinner,
  onView,
  onDistill,
  onVariant,
}: {
  group: { formatId: string; formatName: string; items: StudioItem[] };
  campaignId: string;
  busy: string | null;
  finalCost: (resolution: '720p' | '1080p', durationS: number | null) => number | null;
  onCancel: (generationId: string) => void;
  onRegenerate: (itemId: string, mode?: RegenMode) => void;
  onBatch: (formatId: string, mode: 'sample' | 'full') => void;
  onFinal: (itemId: string, resolution: '720p' | '1080p') => void;
  onRedoSamples: (formatId: string) => void;
  onWinner: (item: StudioItem) => void;
  onView: (v: { generationId: string; title: string }) => void;
  onDistill: (item: StudioItem) => void;
  onVariant: (item: StudioItem) => void;
}) {
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

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4">
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
            disabled={pending === 0 || busy !== null || pureSequence}
            title={
              pureSequence
                ? 'Una secuencia se genera completa y en orden: usa «Lote completo».'
                : undefined
            }
            onClick={() => onBatch(group.formatId, 'sample')}
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
            disabled={pending === 0 || busy !== null}
            onClick={() => onBatch(group.formatId, 'full')}
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
                  onClick={() => onCancel(g.generationId as string)}
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
                        onView({
                          generationId: d.generationId as string,
                          title: d.sceneSummary ?? d.scenePrompt,
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
                        onClick={() => onRegenerate(d.id, 'only-this')}
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
                        onClick={() => onRegenerate(d.id, 'this-and-forward')}
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
                      onClick={() => onRegenerate(d.id)}
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
                      onClick={() => onFinal(d.id, '720p')}
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
                      onClick={() => onFinal(d.id, '1080p')}
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
            onClick={() => onRedoSamples(group.formatId)}
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
                      onView({
                        generationId: f.generationId as string,
                        title: f.sceneSummary ?? f.scenePrompt,
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
                  onClick={() => onWinner(f)}
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
                  onClick={() => onDistill(f)}
                >
                  Convertir en plantilla
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={!f.generationId}
                  onClick={() => onVariant(f)}
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
}
