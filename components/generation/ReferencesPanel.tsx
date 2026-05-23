'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import {
  createMediaReferenceAction,
  getUploadSignedUrlAction,
} from '@/server-actions/media-references';

export type ReferenceClient = {
  id: string;
  storagePath: string;
  previewUrl: string;
  filename: string;
};

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = /^image\/(jpeg|png|webp|gif|bmp|tiff)$/i;

export function ReferencesPanel({
  value,
  onChange,
  maxRefs,
}: {
  value: ReferenceClient[];
  onChange: (next: ReferenceClient[]) => void;
  maxRefs: number;
}) {
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    async (file: File): Promise<ReferenceClient | null> => {
      if (file.size > MAX_BYTES) {
        toast.error(`"${file.name}" supera 10 MB`);
        return null;
      }
      if (!ALLOWED.test(file.type)) {
        toast.error(`"${file.name}" no es una imagen válida`);
        return null;
      }
      const urlRes = await getUploadSignedUrlAction({
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!urlRes.ok) {
        toast.error(urlRes.message ?? 'No se pudo iniciar el upload');
        return null;
      }
      const putRes = await fetch(urlRes.data.signedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!putRes.ok) {
        toast.error(`Subida falló (${putRes.status})`);
        return null;
      }
      const created = await createMediaReferenceAction({
        storagePath: urlRes.data.path,
        type: 'image',
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!created.ok) {
        toast.error(created.message ?? 'No se pudo registrar la referencia');
        return null;
      }
      const previewUrl = URL.createObjectURL(file);
      return {
        id: created.data.id,
        storagePath: urlRes.data.path,
        previewUrl,
        filename: file.name,
      };
    },
    [],
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const slots = maxRefs - value.length;
      if (slots <= 0) {
        toast.error(`Máximo ${maxRefs} referencias`);
        return;
      }
      setUploading(true);
      const toProcess = Array.from(files).slice(0, slots);
      const results: ReferenceClient[] = [];
      for (const file of toProcess) {
        const ref = await uploadFile(file);
        if (ref) results.push(ref);
      }
      setUploading(false);
      if (results.length > 0) {
        onChange([...value, ...results]);
      }
    },
    [value, maxRefs, uploadFile, onChange],
  );

  function removeRef(id: string) {
    const target = value.find((r) => r.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    onChange(value.filter((r) => r.id !== id));
  }

  // Liberar todas las object URLs al desmontar.
  useEffect(() => {
    return () => {
      for (const r of value) URL.revokeObjectURL(r.previewUrl);
    };
    // Eslint: queremos cleanup solo en unmount, no en cada cambio de value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Referencias ({value.length}/{maxRefs})
        </Label>
      </div>
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-5 text-center text-xs transition-colors',
          drag ? 'border-primary bg-primary/5' : 'border-border',
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void handleFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void handleFiles(e.target.files);
            if (inputRef.current) inputRef.current.value = '';
          }}
        />
        {uploading ? (
          <>
            <Loader2 className="size-5 animate-spin" aria-hidden />
            <span>Subiendo…</span>
          </>
        ) : (
          <>
            <ImagePlus className="size-5 text-muted-foreground" aria-hidden />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-foreground underline-offset-2 hover:underline"
              disabled={value.length >= maxRefs}
            >
              Arrastra imágenes o haz click
            </button>
            <span className="text-muted-foreground">Máx 10 MB · jpg, png, webp</span>
          </>
        )}
      </div>
      {value.length > 0 && (
        <ul className="grid grid-cols-4 gap-2">
          {value.map((r) => (
            <li
              key={r.id}
              className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.previewUrl} alt={r.filename} className="size-full object-cover" />
              <button
                type="button"
                onClick={() => removeRef(r.id)}
                className="absolute right-1 top-1 rounded-full bg-background/80 p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Quitar referencia"
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
