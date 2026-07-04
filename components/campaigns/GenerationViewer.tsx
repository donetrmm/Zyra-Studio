'use client';

import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
  filename,
  onClose,
}: {
  generationId: string;
  title: string;
  // Nombre de descarga sin extensión (ej. clip-02-a1b2c3); sin él cae al id corto.
  filename?: string;
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
      await downloadFile(detail.outputUrl, filename ?? `1to1-${generationId.slice(0, 8)}`);
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="shrink-0 text-muted-foreground"
            >
              Cerrar
            </Button>
          </div>
          {detail?.outputUrl && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={downloading}
              className="mt-3 text-muted-foreground"
            >
              {downloading ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Download className="size-3.5" aria-hidden />
              )}
              Descargar
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
