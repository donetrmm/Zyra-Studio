'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { uploadReferenceFile } from '@/lib/media-references/upload-client';

export type RefImage = { id: string; previewUrl: string | null };

// Uploader compartido (Brand Kit producto/empaque, hoja maestra del Cast).
// Sube al bucket references vía el flujo estándar (signed URL + registro en
// media_references) y devuelve los ids para guardarlos en el recurso padre.
export function ReferenceImagesUploader({
  label,
  hint,
  images,
  onChange,
  max = 4,
}: {
  label: string;
  hint?: string;
  images: RefImage[];
  onChange: (images: RefImage[]) => void;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const slots = max - images.length;
    const selected = Array.from(files).slice(0, slots);
    if (selected.length === 0) return;
    setUploading(true);
    const added: RefImage[] = [];
    for (const file of selected) {
      const res = await uploadReferenceFile(file);
      if (!res.ok) {
        toast.error(res.message);
        continue;
      }
      added.push({ id: res.ref.id, previewUrl: res.ref.previewUrl });
    }
    setUploading(false);
    if (added.length) onChange([...images, ...added]);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      {hint && <p className="mt-0.5 text-[11.5px] text-muted-foreground/60">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {images.map((img, i) => (
          <div key={img.id} className="group relative size-16 overflow-hidden rounded-lg border border-border bg-muted/30">
            {img.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img.previewUrl} alt={`${label} ${i + 1}`} className="size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center text-[10px] text-muted-foreground/60">img {i + 1}</div>
            )}
            <button
              type="button"
              aria-label="Quitar imagen"
              onClick={() => onChange(images.filter((x) => x.id !== img.id))}
              className="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
            >
              <X className="size-3" aria-hidden />
            </button>
          </div>
        ))}
        {images.length < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="grid size-16 place-items-center rounded-lg border border-dashed border-border text-muted-foreground/60 transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
          >
            {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple={max > 1}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
