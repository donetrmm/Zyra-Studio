'use client';

import { useRef, useState } from 'react';
import { FileAudio, FileVideo, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  referenceKindOf,
  uploadMediaReferenceFile,
  type ReferenceKind,
} from '@/lib/media-references/upload-client';

// Referencias multimodales de Seedance 2.0: hasta 9 imágenes + 3 videos
// (≤15 s combinados) + 3 audios (≤15 s), tope 12 archivos. El ORDEN define la
// numeración @Image1.., @Video1.., @Audio1.. que el prompt puede citar.
export type SeedanceRef = {
  kind: ReferenceKind;
  storagePath: string;
  previewUrl: string;
  filename: string;
  // Origen del activo cuando no es una subida manual: Brand Kit o Cast.
  // sourceLabel se muestra en el thumbnail y en la fila "citar en prompt".
  source?: 'brand' | 'cast';
  sourceLabel?: string;
};

const MAX_PER_KIND: Record<ReferenceKind, number> = { image: 9, video: 3, audio: 3 };
const MAX_TOTAL = 12;

export function seedanceRefLabel(refs: SeedanceRef[], index: number): string {
  const ref = refs[index];
  const nOfKind = refs.slice(0, index + 1).filter((r) => r.kind === ref.kind).length;
  const prefix = ref.kind === 'image' ? '@Image' : ref.kind === 'video' ? '@Video' : '@Audio';
  return `${prefix}${nOfKind}`;
}

// Frase lista para pegar en el prompt: cada referencia debe citarse con un
// propósito declarado (regla Seedance: ref sin propósito = error más común).
function citeText(refs: SeedanceRef[], index: number): string {
  const ref = refs[index];
  const label = seedanceRefLabel(refs, index);
  const subject = (ref.sourceLabel ?? ref.filename).split(' · ')[0];
  if (ref.source === 'cast') return `${label} es ${subject}; mantén su identidad exacta.`;
  if (ref.source === 'brand') return `${label} es el ${subject}; respeta su diseño exacto.`;
  return `${label} es ${subject}.`;
}

export function SeedanceRefsPanel({
  refs,
  setRefs,
  disabled,
  onCite,
}: {
  refs: SeedanceRef[];
  setRefs: (v: SeedanceRef[]) => void;
  disabled?: boolean;
  // Inserta una cita "@ImageN es …" en el prompt (refs de Brand Kit / Cast).
  onCite?: (text: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    const next = [...refs];
    for (const file of Array.from(files)) {
      const kind = referenceKindOf(file);
      if (!kind) {
        toast.error(`"${file.name}": tipo no soportado (imagen, mp4/mov, mp3/wav)`);
        continue;
      }
      if (next.length >= MAX_TOTAL) {
        toast.error(`Máximo ${MAX_TOTAL} archivos en total`);
        break;
      }
      const ofKind = next.filter((r) => r.kind === kind).length;
      if (ofKind >= MAX_PER_KIND[kind]) {
        toast.error(`Máximo ${MAX_PER_KIND[kind]} de tipo ${kind}`);
        continue;
      }
      const res = await uploadMediaReferenceFile(file);
      if (!res.ok) {
        toast.error(res.message);
        continue;
      }
      next.push({
        kind,
        storagePath: res.ref.storagePath,
        previewUrl: res.ref.previewUrl,
        filename: res.ref.filename,
      });
    }
    setRefs(next);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  function remove(index: number) {
    const ref = refs[index];
    if (ref) URL.revokeObjectURL(ref.previewUrl);
    setRefs(refs.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,audio/mpeg,audio/wav"
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />

      {refs.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {refs.map((ref, i) => (
            <div key={ref.storagePath} className="relative overflow-hidden rounded-lg border border-border">
              {ref.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ref.previewUrl} alt={ref.filename} className="h-16 w-full object-cover" />
              ) : (
                <div className="grid h-16 w-full place-items-center bg-muted/30">
                  {ref.kind === 'video' ? (
                    <FileVideo className="size-5 text-muted-foreground/60" aria-hidden />
                  ) : (
                    <FileAudio className="size-5 text-muted-foreground/60" aria-hidden />
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Quitar ${ref.filename}`}
                className="absolute right-1 top-1 grid size-4.5 place-items-center rounded-full bg-background/80 text-foreground backdrop-blur transition-colors hover:bg-background"
              >
                <X className="size-2.5" aria-hidden />
              </button>
              <div className="absolute bottom-1 left-1 flex max-w-[calc(100%-8px)] items-center gap-1 rounded bg-background/75 px-1 py-0.5 backdrop-blur">
                <span className="font-mono text-[9px] text-foreground/90">{seedanceRefLabel(refs, i)}</span>
                {ref.sourceLabel && (
                  <span className="truncate text-[8.5px] text-primary/90">{ref.sourceLabel}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {onCite && refs.some((r) => r.sourceLabel) && (
        <div className="space-y-1">
          {refs.map((ref, i) =>
            ref.sourceLabel ? (
              <div
                key={ref.storagePath}
                className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1"
              >
                <span className="truncate text-[11px] text-muted-foreground">
                  <span className="font-mono text-foreground/90">{seedanceRefLabel(refs, i)}</span>
                  {' — '}
                  {ref.sourceLabel}
                </span>
                <button
                  type="button"
                  onClick={() => onCite(citeText(refs, i))}
                  className="shrink-0 text-[10.5px] text-primary/80 transition-colors hover:text-primary"
                >
                  Citar en prompt
                </button>
              </div>
            ) : null,
          )}
        </div>
      )}

      <button
        type="button"
        disabled={disabled || uploading || refs.length >= MAX_TOTAL}
        onClick={() => fileRef.current?.click()}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-[12px] text-muted-foreground transition-colors hover:border-muted-foreground/40 disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
        {uploading ? 'Subiendo…' : 'Agregar referencias (imágenes, video, audio)'}
      </button>

      {refs.length > 0 && (
        <p className="px-1 text-[10.5px] leading-relaxed text-muted-foreground/60">
          Cita cada archivo en el prompt con su etiqueta y un propósito: &quot;@Image1 es el producto,
          empaque exacto&quot;, &quot;replica el movimiento de cámara de @Video1&quot;, &quot;@Audio1 marca el ritmo&quot;.
          Una referencia sin propósito declarado es el error más común.
        </p>
      )}
    </div>
  );
}
