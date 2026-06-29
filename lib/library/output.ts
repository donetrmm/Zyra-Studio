'use client';

import { toast } from 'sonner';
import { downloadGenerationImage } from '@/lib/media-references/download-client';
import { extFromMime } from './format';
import type { LibraryGeneration } from './types';

export async function fetchOutputUrl(generationId: string): Promise<string | null> {
  const res = await fetch(`/api/generations/${generationId}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const data = (await res.json()) as { outputUrl?: string };
  return data.outputUrl ?? null;
}

// Descarga un unico output. Lanza si no hay output; el caller maneja el toast
// para conservar su texto exacto.
export async function downloadOne(generationId: string, filenameHint: string): Promise<void> {
  const url = await fetchOutputUrl(generationId);
  if (!url) throw new Error('sin output');
  await downloadGenerationImage(url, filenameHint);
}

// Empaqueta la seleccion en un unico .zip. El navegador bloquea descargas
// multiples automaticas, asi que un solo zip es lo fiable. JSZip on-demand.
export async function bulkDownload(selected: LibraryGeneration[]): Promise<void> {
  const items = selected.filter((g) => g.hasOutput);
  if (items.length === 0) {
    toast.error('Nada que descargar en la selección');
    return;
  }
  if (items.length === 1) {
    try {
      await downloadOne(items[0].id, `1to1-${items[0].id.slice(0, 8)}`);
    } catch {
      toast.error('No se pudo descargar');
    }
    return;
  }
  const toastId = toast.loading(`Preparando ${items.length} archivos…`);
  try {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    let added = 0;
    for (let i = 0; i < items.length; i++) {
      const g = items[i];
      try {
        const outputUrl = await fetchOutputUrl(g.id);
        if (!outputUrl) continue;
        const fileRes = await fetch(outputUrl);
        if (!fileRes.ok) continue;
        const blob = await fileRes.blob();
        zip.file(
          `${String(i + 1).padStart(2, '0')}-1to1-${g.id.slice(0, 8)}.${extFromMime(blob.type)}`,
          blob,
        );
        added += 1;
      } catch {
        // saltar este archivo, seguir con el resto
      }
    }
    if (added === 0) {
      toast.error('No se pudo descargar la selección', { id: toastId });
      return;
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '1to1-biblioteca.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    const skipped = items.length - added;
    toast.success(
      `${added} archivo${added === 1 ? '' : 's'} en un zip${skipped > 0 ? ` · ${skipped} omitido${skipped === 1 ? '' : 's'}` : ''}`,
      { id: toastId },
    );
  } catch {
    toast.error('No se pudo preparar la descarga', { id: toastId });
  }
}
