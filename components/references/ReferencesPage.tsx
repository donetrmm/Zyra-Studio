'use client';

import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Files, ImageIcon, Loader2, Search, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { uploadReferenceFile } from '@/lib/media-references/upload-client';
import { deleteMediaReferenceAction } from '@/server-actions/media-references';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { PageEmptyState } from '@/components/ui/page-empty-state';
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
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [deleting, startDelete] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Re-sincroniza tras router.refresh(): ajuste de estado durante render,
  // no en effect (react.dev/learn/you-might-not-need-an-effect).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setRefs(initial);
    setSelected(new Set());
  }
  const [query, setQuery] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query) return refs;
    const q = query.toLowerCase();
    return refs.filter((r) => r.name.toLowerCase().includes(q) || r.source.includes(q));
  }, [refs, query]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.id)));
  }

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const list = Array.from(files).slice(0, 10);
      setUploading(true);
      setUploadProgress({ done: 0, total: list.length });
      let ok = 0;
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        const res = await uploadReferenceFile(file);
        if (res.ok) ok++;
        else toast.error(`${file.name}: ${res.message}`);
        setUploadProgress({ done: i + 1, total: list.length });
      }
      setUploading(false);
      setUploadProgress(null);
      if (ok > 0) toast.success(`${ok} de ${list.length} subida${ok > 1 ? 's' : ''}`);
      router.refresh();
    },
    [router],
  );

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({
      title: `Eliminar "${name}"?`,
      description: 'La referencia se eliminara permanentemente.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    startDelete(async () => {
      const res = await deleteMediaReferenceAction({ id });
      if (res.ok) {
        setRefs((r) => r.filter((x) => x.id !== id));
        setSelected((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
        toast.success('Eliminada');
      } else toast.error(res.message || 'Error');
    });
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    const ok = await confirm({
      title: `Eliminar ${selected.size} referencia${selected.size > 1 ? 's' : ''}?`,
      description: 'Esta accion no se puede deshacer.',
      confirmLabel: 'Eliminar todas',
      destructive: true,
    });
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
            Imágenes de referencia para usar en tus generaciones. Sube imágenes o guarda
            generaciones como referencia desde la biblioteca.
          </p>
        </div>
        {/* CTA secundario: el dropzone abajo es el affordance principal de subida.
            Usamos PrimaryGhost para alinear con el resto de la app (Library, previews). */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          Subir
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void handleFiles(e.target.files);
            if (fileRef.current) fileRef.current.value = '';
          }}
        />
      </div>

      {/* Dropzone visible — primary affordance para subir. Match del estilo del
          ReferencesPanel inline en image creator. */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Subir imágenes de referencia"
        aria-disabled={uploading || undefined}
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
        onClick={() => !uploading && fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!uploading) fileRef.current?.click();
          }
        }}
        className={cn(
          'mt-5 cursor-pointer rounded-xl border border-dashed bg-muted/40 px-4 py-6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          drag ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-muted-foreground/30',
          uploading && 'cursor-wait opacity-80',
        )}
      >
        <div className="flex flex-col items-center gap-1.5 text-muted-foreground/70">
          {uploading ? (
            <>
              <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
              <div className="text-[12.5px] text-foreground">
                Subiendo {uploadProgress?.done ?? 0} de {uploadProgress?.total ?? 0}…
              </div>
              {uploadProgress && (
                <div className="mt-1 h-1 w-40 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-[width] duration-300"
                    style={{
                      width: `${(uploadProgress.done / Math.max(uploadProgress.total, 1)) * 100}%`,
                    }}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <Upload className="size-5" aria-hidden />
              <div className="text-[13px] text-foreground">
                Arrastra imágenes o haz click para subir
              </div>
              <div className="font-mono text-[11px]">JPG · PNG · WEBP · GIF · max 10 MB</div>
            </>
          )}
        </div>
      </div>

      {refs.length > 0 && (
        <div className="mt-4 flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre..."
              className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <button
            type="button"
            onClick={selectAll}
            className="rounded-md border border-border px-3 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {selected.size === filtered.length && filtered.length > 0
              ? 'Deseleccionar'
              : 'Seleccionar todo'}
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2">
          <span className="text-[12.5px] text-foreground">
            {selected.size} seleccionada{selected.size > 1 ? 's' : ''}
          </span>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-[12px] font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
            Eliminar seleccionadas
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancelar
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <PageEmptyState
          icon={Files}
          title={query ? 'Sin resultados' : 'No tienes referencias'}
          sub={
            query
              ? 'Intenta con otro término o limpia la búsqueda.'
              : 'Arrastra imágenes al dropzone de arriba o guarda generaciones como referencia desde la biblioteca.'
          }
        />
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((r) => {
            const isSel = selected.has(r.id);
            return (
              <div
                key={r.id}
                className={cn(
                  'group relative overflow-hidden rounded-xl border bg-card/50 transition-colors',
                  isSel ? 'border-primary' : 'border-border hover:border-muted-foreground/20',
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleSelect(r.id)}
                  className="block w-full text-left"
                  aria-label={`Seleccionar ${r.name}`}
                >
                  {r.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.previewUrl}
                      alt={r.name}
                      loading="lazy"
                      decoding="async"
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <div className="grid aspect-square place-items-center bg-muted/20">
                      <ImageIcon className="size-8 text-muted-foreground/30" aria-hidden />
                    </div>
                  )}
                </button>
                <div className="px-2.5 py-2">
                  <p className="truncate text-[12px] font-medium text-foreground">{r.name}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground/70">
                    <span>{r.source === 'generation' ? 'Generación' : 'Upload'}</span>
                    <span>·</span>
                    <span>
                      {new Date(r.createdAt).toLocaleDateString('es-MX', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                  </div>
                </div>

                {/* Checkbox y trash con hitSlop: el botón visible es 20px pero
                    el área tappable se extiende a 32px via padding negativo. */}
                <button
                  type="button"
                  onClick={() => toggleSelect(r.id)}
                  aria-label={isSel ? 'Quitar selección' : 'Seleccionar'}
                  className={cn(
                    'absolute -left-1 -top-1 grid size-9 place-items-center transition-colors',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-5 place-items-center rounded border transition-colors',
                      isSel
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-foreground/60 bg-background/60 opacity-0 backdrop-blur group-hover:opacity-100',
                    )}
                  >
                    {isSel && <Check className="size-3" aria-hidden />}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(r.id, r.name)}
                  disabled={deleting}
                  aria-label="Eliminar referencia"
                  className="absolute -right-1 -top-1 grid size-9 place-items-center text-muted-foreground transition-colors disabled:cursor-not-allowed"
                >
                  <span className="grid size-6 place-items-center rounded-full bg-background/70 opacity-0 backdrop-blur transition-[opacity,color] group-hover:opacity-100 hover:text-destructive">
                    <Trash2 className="size-3" aria-hidden />
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
