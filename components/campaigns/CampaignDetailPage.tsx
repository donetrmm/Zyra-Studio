'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, FolderKanban, ImageIcon, Loader2, Mic, Video, X } from 'lucide-react';
import { toast } from 'sonner';
import { downloadGenerationImage as downloadFile } from '@/lib/media-references/download-client';

type Generation = {
  id: string;
  type: string;
  prompt: string;
  status: string;
  thumbnailUrl: string | null;
  credits: number;
  createdAt: string;
};

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
};

const TYPE_ICON = { image: ImageIcon, video: Video, audio: Mic } as const;

export function CampaignDetailPage({
  campaign,
  generations,
}: {
  campaign: Campaign;
  generations: Generation[];
}) {
  const [selected, setSelected] = useState<Generation | null>(null);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/app/campaigns"
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Campañas
      </Link>

      <div className="flex items-start gap-3">
        <div className="mt-1 size-3 shrink-0 rounded-full" style={{ backgroundColor: campaign.color }} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[18px] font-semibold text-foreground">{campaign.name}</h1>
          {campaign.description && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">{campaign.description}</p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground/50">
            {generations.length} generacion{generations.length !== 1 ? 'es' : ''} · creada {new Date(campaign.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
      </div>

      {generations.length === 0 ? (
        <div className="mt-12 flex flex-col items-center gap-3 text-center text-muted-foreground/60">
          <div className="grid size-16 place-items-center rounded-2xl border border-border bg-muted/30">
            <FolderKanban className="size-7" aria-hidden />
          </div>
          <p className="text-[14px] text-foreground/70">Sin generaciones asignadas</p>
          <p className="max-w-xs text-[12.5px]">Asigna generaciones desde la biblioteca o al crear contenido</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {generations.map((g) => {
            const Icon = TYPE_ICON[g.type as keyof typeof TYPE_ICON] ?? ImageIcon;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setSelected(g)}
                className="group overflow-hidden rounded-xl border border-border bg-card/50 text-left transition-colors hover:border-muted-foreground/20"
              >
                {g.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.thumbnailUrl} alt={g.prompt} className="aspect-square w-full object-cover" />
                ) : (
                  <div className="grid aspect-square place-items-center bg-muted/20">
                    <Icon className="size-8 text-muted-foreground/30" aria-hidden />
                  </div>
                )}
                <div className="p-2.5">
                  <p className="line-clamp-2 text-[11px] text-muted-foreground/70">{g.prompt || 'Sin prompt'}</p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/40">
                    <Icon className="size-3" aria-hidden />
                    <span>{g.status === 'done' ? `−${g.credits} cr` : g.status}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <GenerationModal generation={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function GenerationModal({ generation, onClose }: { generation: Generation; onClose: () => void }) {
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const Icon = TYPE_ICON[generation.type as keyof typeof TYPE_ICON] ?? ImageIcon;

  useEffect(() => {
    let active = true;
    fetch(`/api/generations/${generation.id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { outputUrl?: string } | null) => {
        if (active) {
          setOutputUrl(data?.outputUrl ?? null);
          setLoading(false);
        }
      })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [generation.id]);

  async function handleDownload() {
    if (!outputUrl) return;
    setDownloading(true);
    try {
      await downloadFile(outputUrl, 'zyra-generation');
    } catch {
      toast.error('No se pudo descargar');
    } finally {
      setDownloading(false);
    }
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
        className="scroll-thin mx-4 max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative bg-black">
          {loading ? (
            <div className="grid aspect-video place-items-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : outputUrl ? (
            generation.type === 'video' ? (
              <video controls autoPlay muted playsInline src={outputUrl} className="max-h-[50vh] w-full object-contain" />
            ) : generation.type === 'audio' ? (
              <div className="flex items-center justify-center bg-card p-8">
                <audio controls autoPlay src={outputUrl} className="w-full" />
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={outputUrl} alt={generation.prompt} className="max-h-[50vh] w-full object-contain" />
            )
          ) : (
            <div className="grid aspect-video place-items-center text-muted-foreground/40">
              <Icon className="size-10" aria-hidden />
            </div>
          )}
        </div>

        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {generation.prompt && (
                <p className="text-[13px] leading-relaxed text-foreground">{generation.prompt}</p>
              )}
              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground/60">
                <Icon className="size-3" aria-hidden />
                <span>−{generation.credits} cr</span>
                <span>{new Date(generation.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span>
              </div>
            </div>
            <button type="button" onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground">
              <X className="size-5" aria-hidden />
            </button>
          </div>

          {outputUrl && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Descargar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
