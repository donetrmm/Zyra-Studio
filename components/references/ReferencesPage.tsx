'use client';

import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Files, ImageIcon, Loader2, Search, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { uploadReferenceFile } from '@/lib/media-references/upload-client';
import { deleteMediaReferenceAction } from '@/server-actions/media-references';
import { useConfirm } from '@/components/ui/confirm-dialog';
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
  const router = useRouter();
  const confirm = useConfirm();
  const [refs, setRefs] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query) return refs;
    const q = query.toLowerCase();
    return refs.filter((r) => r.name.toLowerCase().includes(q) || r.source.includes(q));
  }, [refs, query]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.id)));
  }

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files).slice(0, 5)) {
      const res = await uploadReferenceFile(file);
      if (!res.ok) { toast.error(res.message); continue; }
      toast.success(`${file.name} subido`);
    }
    setUploading(false);
    router.refresh();
  }, []);

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({ title: `Eliminar "${name}"?`, description: 'La referencia se eliminara permanentemente.', confirmLabel: 'Eliminar', destructive: true });
    if (!ok) return;
    startDelete(async () => {
      const res = await deleteMediaReferenceAction({ id });
      if (res.ok) { setRefs((r) => r.filter((x) => x.id !== id)); setSelected((s) => { const n = new Set(s); n.delete(id); return n; }); toast.success('Eliminada'); }
      else toast.error(res.message || 'Error');
    });
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    const ok = await confirm({ title: `Eliminar ${selected.size} referencia${selected.size > 1 ? 's' : ''}?`, description: 'Esta accion no se puede deshacer.', confirmLabel: 'Eliminar todas', destructive: true });
    if (!ok) return;
    startDelete(async () => {
      let deleted = 0;
      for (const id of selected) {
        const res = await deleteMediaReferenceAction({ id });
        if (res.ok) deleted++;
      }
      setRefs((r) => r.filter((x) => !selected.has(x.id)));
      setSelected(new Set());
      toast.success(`${deleted} referencia${deleted > 1 ? 's' : ''} eliminada${deleted > 1 ? 's' : ''}`);
    });
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
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
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
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

      {refs.length > 0 && (
        <div className="mt-4 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre..."
              className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-[13px] text-foreground outline-none focus:border-primary/40"
            />
          </div>
          <button
            type="button"
            onClick={selectAll}
            className="rounded-md border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {selected.size === filtered.length && filtered.length > 0 ? 'Deseleccionar' : 'Seleccionar todo'}
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2">
          <span className="text-[12.5px] text-foreground">{selected.size} seleccionada{selected.size > 1 ? 's' : ''}</span>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1 text-[12px] font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
            Eliminar seleccionadas
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center text-muted-foreground/60">
          <div className="grid size-16 place-items-center rounded-2xl border border-border bg-muted/30">
            <Files className="size-7" aria-hidden />
          </div>
          <p className="text-[14px] text-foreground/70">{query ? 'Sin resultados' : 'No tienes referencias'}</p>
          <p className="max-w-xs text-[12.5px]">{query ? 'Intenta otro término' : 'Sube imágenes para usarlas como referencia visual'}</p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((r) => {
            const isSel = selected.has(r.id);
            return (
              <div key={r.id} className={cn('group relative overflow-hidden rounded-xl border bg-card/50 transition-colors', isSel ? 'border-primary' : 'border-border hover:border-muted-foreground/20')}>
                <button type="button" onClick={() => toggleSelect(r.id)} className="block w-full text-left">
                  {r.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.previewUrl} alt={r.name} className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="grid aspect-square place-items-center bg-muted/20">
                      <ImageIcon className="size-8 text-muted-foreground/30" aria-hidden />
                    </div>
                  )}
                </button>
                <div className="p-2.5">
                  <p className="truncate text-[11.5px] font-medium text-foreground">{r.name}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground/50">
                    <span>{r.source === 'generation' ? 'Generación' : 'Upload'}</span>
                    <span>{new Date(r.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span>
                  </div>
                </div>
                {(isSel || true) && (
                  <button
                    type="button"
                    onClick={() => toggleSelect(r.id)}
                    className={cn(
                      'absolute left-1.5 top-1.5 grid size-5 place-items-center rounded border transition-colors',
                      isSel ? 'border-primary bg-primary text-primary-foreground' : 'border-foreground/60 bg-background/60 opacity-0 backdrop-blur group-hover:opacity-100',
                    )}
                  >
                    {isSel && <Check className="size-3" aria-hidden />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(r.id, r.name)}
                  disabled={deleting}
                  className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-background/70 text-muted-foreground opacity-0 backdrop-blur transition-all group-hover:opacity-100 hover:text-destructive disabled:cursor-not-allowed"
                >
                  <Trash2 className="size-3" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
