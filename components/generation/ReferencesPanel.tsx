'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
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

  useEffect(() => {
    return () => {
      for (const r of value) URL.revokeObjectURL(r.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        className="cursor-pointer rounded-xl transition-all"
        style={{
          padding: count === 0 ? '22px 14px' : '10px',
          background: drag ? 'var(--zyra-accent-soft)' : 'var(--zyra-bg-2)',
          border: `1px dashed ${drag ? 'var(--zyra-accent-rim)' : 'var(--zyra-hairline)'}`,
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
        {count === 0 ? (
          <div
            className="flex flex-col items-center gap-1.5"
            style={{ color: 'var(--zyra-text-3)' }}
          >
            {uploading ? (
              <Loader2 className="size-[18px] animate-spin" aria-hidden />
            ) : (
              <Upload className="size-[18px]" aria-hidden />
            )}
            <div className="text-[12.5px]" style={{ color: 'var(--zyra-text-2)' }}>
              {uploading ? 'Subiendo…' : 'Arrastra imágenes o haz click'}
            </div>
            <div
              className="text-[10.5px]"
              style={{ fontFamily: 'var(--zyra-font-mono)' }}
            >
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
                className="relative aspect-square overflow-hidden rounded-lg"
                style={{ border: '1px solid var(--zyra-hairline)' }}
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
                  className="absolute right-0.5 top-0.5 grid size-[18px] place-items-center rounded-full backdrop-blur"
                  style={{ background: 'rgba(0, 0, 0, 0.6)', color: '#fff' }}
                  aria-label="Quitar referencia"
                >
                  <X className="size-2.5" aria-hidden />
                </button>
                <div
                  className="absolute bottom-0.5 left-1 rounded px-1.5 text-[9.5px]"
                  style={{
                    fontFamily: 'var(--zyra-font-mono)',
                    color: 'rgba(255, 255, 255, 0.85)',
                    background: 'rgba(0, 0, 0, 0.5)',
                  }}
                >
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
                className="grid aspect-square place-items-center rounded-lg"
                style={{
                  border: '1px dashed var(--zyra-hairline-strong)',
                  color: 'var(--zyra-text-3)',
                  background: 'transparent',
                }}
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
        <div
          className="mt-2 flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[11.5px]"
          style={{
            background: 'var(--zyra-warn-soft)',
            border: '1px solid rgba(245, 181, 68, 0.25)',
            color: 'var(--zyra-warn)',
          }}
        >
          Acepta máximo {maxRefs} referencias. Quita {count - maxRefs}.
        </div>
      )}
    </div>
  );
}
