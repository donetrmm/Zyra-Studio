'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import { Files, ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { uploadReferenceFile } from '@/lib/media-references/upload-client';
import { deleteMediaReferenceAction } from '@/server-actions/media-references';
import { cn } from '@/lib/utils';

type ReferenceRow = {
  id: string;
  type: string;
  name: string;
  source: string;
  previewUrl: string | null;
  createdAt: string;
};

export function ReferencesPage({ references: initial }: { references: ReferenceRow[] }) {
  const [refs, setRefs] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const [deleting, startDelete] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files).slice(0, 5)) {
      const res = await uploadReferenceFile(file);
      if (!res.ok) { toast.error(res.message); continue; }
      toast.success(`${file.name} subido`);
    }
    setUploading(false);
    window.location.reload();
  }, []);

  function handleDelete(id: string, name: string) {
    if (!confirm(`Eliminar "${name}"?`)) return;
    startDelete(async () => {
      const res = await deleteMediaReferenceAction({ id });
      if (res.ok) { setRefs((r) => r.filter((x) => x.id !== id)); toast.success('Referencia eliminada'); }
      else toast.error(res.message || 'Error');
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 lg:px-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">Referencias</h1>
          <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
            Imágenes de referencia para usar en tus generaciones. Sube imágenes o guarda generaciones como referencia desde la biblioteca.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Subir imagen
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => { void handleFiles(e.target.files); if (fileRef.current) fileRef.current.value = ''; }}
        />
      </div>

      {refs.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center text-muted-foreground/60">
          <div className="grid size-16 place-items-center rounded-2xl border border-border bg-muted/30">
            <Files className="size-7" aria-hidden />
          </div>
          <p className="text-[14px] text-foreground/70">No tienes referencias</p>
          <p className="max-w-xs text-[12.5px]">Sube imágenes para usarlas como referencia visual en tus generaciones</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {refs.map((r) => (
            <div key={r.id} className="group relative overflow-hidden rounded-xl border border-border bg-card/50 transition-colors hover:border-muted-foreground/20">
              {r.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.previewUrl} alt={r.name} className="aspect-square w-full object-cover" />
              ) : (
                <div className="grid aspect-square place-items-center bg-muted/20">
                  <ImageIcon className="size-8 text-muted-foreground/30" aria-hidden />
                </div>
              )}
              <div className="p-2.5">
                <p className="truncate text-[11.5px] font-medium text-foreground">{r.name}</p>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground/50">
                  <span>{r.source === 'generation' ? 'Generación' : 'Upload'}</span>
                  <span>{new Date(r.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(r.id, r.name)}
                disabled={deleting}
                className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-background/70 text-muted-foreground opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 hover:text-destructive"
              >
                <Trash2 className="size-3" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
