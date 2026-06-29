'use client';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { Copy, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { aspectRatioToNumber, modelLabel, reuseHref, shortTime } from '@/lib/library/format';
import { downloadGenerationImage } from '@/lib/media-references/download-client';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import type { LibraryGeneration } from '@/lib/library/types';
import { DetailRow } from './DetailRow';
import { DetailField } from './DetailField';
import { CampaignAssigner } from './CampaignAssigner';
import { DetailMediaPreview } from './DetailMediaPreview';
import { DetailActions } from './DetailActions';
import { DetailHistory } from './DetailHistory';

export function DetailAside({
  generation,
  allGenerations,
  onClose,
  onNavigate,
  isFavorite,
  onToggleFav,
  onDelete,
}: {
  generation: LibraryGeneration;
  allGenerations: LibraryGeneration[];
  onClose: () => void;
  onNavigate: (id: string) => void;
  isFavorite: boolean;
  onToggleFav: (id: string) => void;
  onDelete: () => void;
}) {
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [addingRef, startAddRef] = useTransition();

  useEffect(() => {
    // Componente se remonta con key={generation.id} cuando cambia la selección,
    // así que loading inicia en true por estado inicial y solo hace falta fetch.
    let cancelled = false;
    fetch(`/api/generations/${generation.id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { outputUrl?: string } | null) => {
        if (!cancelled) {
          setOutputUrl(data?.outputUrl ?? null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [generation.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ratio = aspectRatioToNumber(generation.aspectRatio);

  async function handleDownload() {
    if (!outputUrl || downloading) return;
    setDownloading(true);
    try {
      await downloadGenerationImage(outputUrl, `1to1-${generation.id.slice(0, 8)}`);
    } catch {
      toast.error('No se pudo descargar.');
    } finally {
      setDownloading(false);
    }
  }

  // Solo imágenes: copia el output al bucket de referencias para reusarlo
  // como referencia en futuras generaciones.
  function handleUseAsRef() {
    if (addingRef) return;
    startAddRef(async () => {
      const res = await addGenerationAsReferenceAction({ generationId: generation.id });
      if (!res.ok) {
        toast.error(res.message ?? 'No se pudo usar como referencia');
        return;
      }
      toast.success('Agregada a tus referencias');
    });
  }

  async function handleCopyPrompt() {
    try {
      await navigator.clipboard.writeText(generation.prompt);
      toast.success('Prompt copiado');
    } catch {
      toast.error('No se pudo copiar el prompt');
    }
  }

  return (
    <aside className="zyra-fade-in fixed inset-y-0 right-0 z-50 flex w-[min(360px,85vw)] shrink-0 flex-col border-l border-border bg-card shadow-[-8px_0_30px_-10px_rgba(0,0,0,0.5)] lg:static lg:z-auto lg:w-[360px] lg:shadow-none">
      <header className="flex h-11 items-center justify-between border-b border-border px-4">
        <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
          Detalle
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Cerrar (Esc)"
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </header>

      {/* En mobile la MobileBottomNav (~52px) tapa la parte baja del aside
          porque ambos comparten z-50 y la nav viene después en el DOM.
          Reservamos espacio extra abajo para que el contenido scrollable no
          quede oculto detrás de la nav. En desktop volvemos a pb-6. */}
      <div className="scroll-thin flex-1 overflow-y-auto px-4 pb-[88px] pt-4 lg:pb-6">
        <DetailMediaPreview generation={generation} outputUrl={outputUrl} loading={loading} ratio={ratio} />

        {generation.prompt && (
          <Link
            href={reuseHref(generation)}
            className="mb-1.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-primary/15"
          >
            <RotateCcw className="size-3.5" aria-hidden /> Reusar prompt
          </Link>
        )}

        <DetailActions
          generation={generation}
          outputUrl={outputUrl}
          isFavorite={isFavorite}
          onToggleFav={onToggleFav}
          onDownload={handleDownload}
          downloading={downloading}
          onUseAsRef={handleUseAsRef}
          addingRef={addingRef}
          onDelete={onDelete}
        />

        <DetailRow label="Prompt">
          <div className="text-[13px] leading-[1.5] text-foreground">
            {generation.prompt || (
              <span className="text-muted-foreground">(sin prompt)</span>
            )}
          </div>
          {generation.prompt && (
            <button
              type="button"
              onClick={handleCopyPrompt}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Copy className="size-3" aria-hidden /> Copiar
            </button>
          )}
        </DetailRow>

        <DetailField label="Modelo" value={modelLabel(generation)} />
        <DetailField label="Aspecto" value={generation.aspectRatio ?? '—'} />
        <DetailField label="Estado" value={generation.status} />
        <DetailField
          label="Créditos"
          value={`−${generation.credits}`}
          mono
        />
        <DetailField
          label="Generado"
          value={shortTime(generation.createdAt)}
        />
        <DetailField label="ID" value={generation.id.slice(0, 8)} mono />

        <CampaignAssigner generation={generation} />

        <DetailHistory generation={generation} allGenerations={allGenerations} onNavigate={onNavigate} />
      </div>
    </aside>
  );
}
