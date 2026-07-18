'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadGenerationImage } from '@/lib/media-references/download-client';

// Descarga la imagen a resolución completa de un turno del estudio. Reusa el
// patrón del resto de la app: /api/generations/[id] firma el output_url interno
// (valida ownership) y downloadGenerationImage baja el blob — la URL del
// proveedor nunca llega al cliente.
export function DownloadTurnButton(props: {
  generationId: string;
  variant?: 'ghost' | 'secondary';
  iconOnly?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function handle() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/generations/${props.generationId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { outputUrl: string | null };
      if (!data.outputUrl) throw new Error('sin salida');
      await downloadGenerationImage(data.outputUrl, `1to1-${props.generationId.slice(0, 8)}`);
    } catch {
      toast.error('No se pudo descargar la imagen');
    } finally {
      setBusy(false);
    }
  }

  const Icon = busy ? Loader2 : Download;
  return (
    <Button
      type="button"
      size={props.iconOnly ? 'icon' : 'sm'}
      variant={props.variant ?? 'ghost'}
      className={props.className ?? (props.iconOnly ? 'h-7 w-7' : 'h-7 gap-1 text-xs')}
      disabled={busy}
      onClick={handle}
      title="Descargar imagen"
      aria-label="Descargar imagen"
    >
      <Icon className={`h-3.5 w-3.5${busy ? ' animate-spin' : ''}`} />
      {props.iconOnly ? null : 'Descargar'}
    </Button>
  );
}
