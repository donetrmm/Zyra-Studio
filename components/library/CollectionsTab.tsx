'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FolderKanban, Layers, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  createCampaignAction,
  updateCampaignAction,
  deleteCampaignAction,
} from '@/server-actions/campaigns';
import { useConfirm } from '@/components/ui/confirm-dialog';

// Colecciones: las carpetas ligeras de V1, ahora dentro de la Biblioteca.
// "Campaña" queda reservado al pipeline del Campaign Studio (specs/v2/06 §4.3).
export type Collection = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
  generationCount: number;
  // Campaña studio: aparece como colección automática (todo lo que genera vive
  // aquí, ligado por campaign_id). No editable/borrable desde la Biblioteca —
  // se gestiona en el Campaign Studio.
  readOnly?: boolean;
};

export function CollectionsTab({ collections: initial }: { collections: Collection[] }) {
  const router = useRouter();
  const [collections, setCollections] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setCollections(initial);
  }
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Collection | 'new' | null>(null);

  return (
    <div className="mx-auto max-w-5xl py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-lg text-[12.5px] leading-relaxed text-muted-foreground">
          Tus campañas aparecen aquí automáticamente con todo lo que generan. Las colecciones
          agrupan generaciones sueltas por proyecto o cliente; tus carpetas de antes viven aquí.
        </p>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-3.5 py-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="size-4" aria-hidden />
          Nueva colección
        </button>
      </div>

      {editing && (
        <CollectionEditor
          collection={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      )}

      {collections.length === 0 && !editing ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center text-muted-foreground/60">
          <div className="grid size-16 place-items-center rounded-2xl border border-border bg-muted/30">
            <FolderKanban className="size-7" aria-hidden />
          </div>
          <p className="text-[14px] text-foreground/70">Sin colecciones</p>
          <p className="max-w-xs text-[12.5px]">
            Una colección agrupa generaciones sueltas: un cliente, un proyecto, una idea.
          </p>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="size-4" aria-hidden />
            Crear colección
          </button>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((c) => (
            <div
              key={c.id}
              className="group overflow-hidden rounded-xl border border-border bg-card/50 transition-colors hover:border-muted-foreground/20"
            >
              <Link
                href={c.readOnly ? `/app/campaigns/${c.id}?view=assets` : `/app/campaigns/${c.id}`}
                className="block"
              >
                <div className="h-2" style={{ backgroundColor: c.color }} />
                <div className="p-4">
                  <div className="flex items-center gap-2">
                    <h3 className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">{c.name}</h3>
                    {c.readOnly && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-primary">
                        <Layers className="size-2.5" aria-hidden />
                        Campaña
                      </span>
                    )}
                  </div>
                  {c.description && (
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{c.description}</p>
                  )}
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>
                      {c.generationCount} generacion{c.generationCount !== 1 ? 'es' : ''}
                    </span>
                    <span>
                      {new Date(c.created_at).toLocaleDateString('es-MX', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                </div>
              </Link>
              {!c.readOnly && (
                <div className="flex gap-2 border-t border-border/30 p-3">
                  <button
                    type="button"
                    onClick={() => setEditing(c)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="size-3" aria-hidden /> Editar
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Eliminar "${c.name}"?`,
                        description: 'Se eliminará la colección y se desvincularán sus generaciones.',
                        confirmLabel: 'Eliminar',
                        destructive: true,
                      });
                      if (!ok) return;
                      deleteCampaignAction(c.id).then((res) => {
                        if (res.ok) {
                          setCollections((cs) => cs.filter((x) => x.id !== c.id));
                          toast.success('Colección eliminada');
                        } else toast.error(res.message || 'Error');
                      });
                    }}
                    className="inline-flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:border-destructive/40 hover:text-destructive"
                  >
                    <Trash2 className="size-3" aria-hidden />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionEditor({
  collection,
  onClose,
  onSaved,
}: {
  collection: Collection | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(collection?.name ?? '');
  const [description, setDescription] = useState(collection?.description ?? '');
  const [color, setColor] = useState(collection?.color ?? '#009fff');
  const [saving, startSave] = useTransition();

  function handleSave() {
    const payload = { name, description: description || undefined, color };
    startSave(async () => {
      const res = collection
        ? await updateCampaignAction(collection.id, payload)
        : await createCampaignAction(payload);
      if (!res.ok) {
        toast.error(res.message || 'Error');
        return;
      }
      toast.success(collection ? 'Colección actualizada' : 'Colección creada');
      onClose();
      onSaved();
    });
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-5 py-3.5">
        <h2 className="text-[15px] font-medium text-foreground">
          {collection ? 'Editar' : 'Nueva'} colección
        </h2>
      </div>
      <div className="space-y-3 p-5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre de la colección"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descripción (opcional)"
          className="w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          rows={2}
        />
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Color
          </label>
          <div className="flex items-center gap-1.5">
            <div className="size-7 rounded-md border border-border" style={{ backgroundColor: color }} />
            <input
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              maxLength={7}
              className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-[13px] text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
