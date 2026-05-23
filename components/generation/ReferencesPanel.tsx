'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Plus, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  createMediaReferenceAction,
  getUploadSignedUrlAction,
} from '@/server-actions/media-references';
import { cn } from '@/lib/utils';

export type ReferenceClient = {
  id: string;
  storagePath: string;
  previewUrl: string;
  filename: string;
};

export type AvailableReference = {
  id: string;
  storagePath: string;
  previewUrl: string | null;
  filename: string;
  source: string;
};

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = /^image\/(jpeg|png|webp|gif|bmp|tiff)$/i;

export function ReferencesPanel({
  value,
  onChange,
  maxRefs,
  available,
}: {
  value: ReferenceClient[];
  onChange: (next: ReferenceClient[]) => void;
  maxRefs: number;
  available: AvailableReference[];
}) {
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const count = value.length;
  const over = count > maxRefs;

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
      const slots = maxRefs - count;
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
      if (results.length > 0) onChange([...value, ...results]);
    },
    [value, count, maxRefs, uploadFile, onChange],
  );

  function removeRef(id: string) {
    const target = value.find((r) => r.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    onChange(value.filter((r) => r.id !== id));
  }

  // Cleanup en unmount: revoca TODOS los object URLs activos.
  // El useEffect con deps [] capturaría el `value` inicial (vacío) y dejaría
  // leak. Usamos un ref sincronizado con cada render para que el cleanup
  // siempre vea la lista actual al momento del unmount.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    return () => {
      for (const r of valueRef.current) URL.revokeObjectURL(r.previewUrl);
    };
  }, []);

  return (
    <div>
      <div
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
        onClick={() => inputRef.current?.click()}
        className={cn(
          'cursor-pointer rounded-xl border border-dashed bg-muted/40 transition-colors',
          drag ? 'border-primary/50 bg-primary/5' : 'border-border',
          count === 0 ? 'px-3.5 py-5' : 'p-2.5',
        )}
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
        {count === 0 ? (
          <div className="flex flex-col items-center gap-1.5 text-muted-foreground/70">
            {uploading ? (
              <Loader2 className="size-[18px] animate-spin" aria-hidden />
            ) : (
              <Upload className="size-[18px]" aria-hidden />
            )}
            <div className="text-[12.5px] text-muted-foreground">
              {uploading ? 'Subiendo…' : 'Arrastra imágenes o haz click'}
            </div>
            <div className="font-mono text-[10.5px]">
              JPG · PNG · WEBP · GIF · BMP · TIFF · max 10 MB
            </div>
          </div>
        ) : (
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))' }}
          >
            {value.map((r, i) => (
              <div
                key={r.id}
                className="relative aspect-square overflow-hidden rounded-lg border border-border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.previewUrl}
                  alt={r.filename}
                  className="size-full object-cover"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeRef(r.id);
                  }}
                  className="absolute right-0.5 top-0.5 grid size-[18px] place-items-center rounded-full bg-background/70 text-foreground backdrop-blur"
                  aria-label="Quitar referencia"
                >
                  <X className="size-2.5" aria-hidden />
                </button>
                <div className="absolute bottom-0.5 left-1 rounded bg-background/70 px-1.5 font-mono text-[9.5px] text-foreground/85">
                  {i + 1}
                </div>
              </div>
            ))}
            {count < maxRefs && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
                className="grid aspect-square place-items-center rounded-lg border border-dashed border-border text-muted-foreground/70 transition-colors hover:border-muted-foreground/40"
                aria-label="Agregar referencia"
              >
                {uploading ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Plus className="size-3.5" aria-hidden />
                )}
              </button>
            )}
          </div>
        )}
      </div>
      {over && (
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-400">
          Acepta máximo {maxRefs} referencias. Quita {count - maxRefs}.
        </div>
      )}

      <AvailablePicker
        available={available}
        selectedIds={value.map((r) => r.id)}
        canAdd={count < maxRefs}
        onPick={(ref) => {
          if (value.some((r) => r.id === ref.id)) return;
          if (count >= maxRefs) {
            toast.error(`Máximo ${maxRefs} referencias para este modelo`);
            return;
          }
          onChange([
            ...value,
            {
              id: ref.id,
              storagePath: ref.storagePath,
              previewUrl: ref.previewUrl ?? '',
              filename: ref.filename,
            },
          ]);
        }}
      />
    </div>
  );
}

function AvailablePicker({
  available,
  selectedIds,
  canAdd,
  onPick,
}: {
  available: AvailableReference[];
  selectedIds: string[];
  canAdd: boolean;
  onPick: (ref: AvailableReference) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  // Filtramos solo las que tienen previewUrl (signed URL válida).
  const items = useMemo(
    () => available.filter((r) => r.previewUrl),
    [available],
  );
  if (items.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              'inline-block size-1.5 rounded-full transition-colors',
              open ? 'bg-primary' : 'bg-muted-foreground/40',
            )}
          />
          Tus referencias
          <span className="font-mono text-[10.5px] text-muted-foreground/60">
            {items.length}
          </span>
        </span>
        <span className="text-[10.5px] text-muted-foreground/70">
          {open ? 'Ocultar' : 'Mostrar'}
        </span>
      </button>

      {open && (
        <div
          className="mt-2 grid gap-1.5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}
        >
          {items.map((r) => {
            const isSel = selectedSet.has(r.id);
            const disabled = !isSel && !canAdd;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  if (isSel || disabled) return;
                  onPick(r);
                }}
                title={
                  isSel
                    ? 'Ya seleccionada'
                    : disabled
                      ? 'Cap de referencias alcanzado'
                      : r.filename
                }
                className={cn(
                  'group relative aspect-square overflow-hidden rounded-md border transition-colors',
                  isSel
                    ? 'border-primary/60 ring-1 ring-primary/30'
                    : disabled
                      ? 'cursor-not-allowed border-border opacity-40'
                      : 'border-border hover:border-muted-foreground/30',
                )}
              >
                {r.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.previewUrl}
                    alt={r.filename}
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-[9px] text-muted-foreground/60">
                    {r.filename.slice(0, 8)}
                  </div>
                )}
                {isSel && (
                  <div className="absolute inset-0 grid place-items-center bg-primary/30 backdrop-blur-[1px]">
                    <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3" aria-hidden />
                    </span>
                  </div>
                )}
                {r.source === 'generation' && !isSel && (
                  <div className="absolute left-0.5 top-0.5 rounded bg-background/70 px-1 font-mono text-[8.5px] text-muted-foreground backdrop-blur">
                    gen
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
