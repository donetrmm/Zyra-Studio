'use client';

import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { downloadGenerationImage as downloadFile } from '@/lib/media-references/download-client';

// Visor de un creativo ya generado, para abrirlo desde la campaña sin ir a la
// Biblioteca. Carga diferida: solo pega a /api/generations/{id} (outputUrl
// firmado) al abrirse. Los creativos de campaña son video.
type Detail = {
  outputUrl: string | null;
  prompt: string | null;
  status: string;
};

export function GenerationViewer({
  generationId,
  title,
  onClose,
}: {
  generationId: string;
  title: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/generations/${generationId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Detail | null) => {
        if (active) {
          setDetail(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [generationId]);

  async function handleDownload() {
    if (!detail?.outputUrl) return;
    setDownloading(true);
    try {
      await downloadFile(detail.outputUrl, `1to1-${generationId.slice(0, 8)}`);
    } catch {
      toast.error('No se pudo descargar el video');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="relative bg-black">
          {loading ? (
            <div className="grid aspect-video place-items-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : detail?.outputUrl ? (
            <video
              controls
              autoPlay
              playsInline
              src={detail.outputUrl}
              // translateZ(0): promueve el video a su propia capa de compositor
              // para que el recorte/efectos del modal no lo hagan tartamudear.
              style={{ transform: 'translateZ(0)' }}
              className="max-h-[60vh] w-full bg-black object-contain"
            />
          ) : (
            <div className="grid aspect-video place-items-center px-6 text-center text-[12.5px] text-muted-foreground/70">
              El resultado todavía no está disponible. Si la generación sigue en curso, vuelve en
              unos segundos.
            </div>
          )}
        </div>
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="line-clamp-3 text-[12.5px] leading-relaxed text-muted-foreground">
              {detail?.prompt?.trim() || title}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md border border-border px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Cerrar
            </button>
          </div>
          {detail?.outputUrl && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {downloading ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Download className="size-3.5" aria-hidden />
              )}
              Descargar
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
