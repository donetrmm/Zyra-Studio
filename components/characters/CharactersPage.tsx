'use client';

import { useState, useTransition } from 'react';
import { Loader2, Plus, Trash2, Pencil, Users } from 'lucide-react';
import { toast } from 'sonner';
import { createCharacterAction, updateCharacterAction, deleteCharacterAction } from '@/server-actions/characters';

type CharacterRow = {
  id: string;
  name: string;
  description: string | null;
  reference_image_ids: string[];
  created_at: string;
};

export function CharactersPage({ characters: initial }: { characters: CharacterRow[] }) {
  const [characters, setCharacters] = useState(initial);
  const [editing, setEditing] = useState<CharacterRow | 'new' | null>(null);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 lg:px-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">Personajes</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Cast de personajes con referencias para consistencia visual
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" aria-hidden />
          Nuevo personaje
        </button>
      </div>

      {editing && (
        <CharacterEditor
          character={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => window.location.reload()}
        />
      )}

      {characters.length === 0 && !editing ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-muted-foreground/60">
          <Users className="size-12" aria-hidden />
          <p className="text-[14px]">No tienes personajes</p>
          <p className="text-[12.5px]">Crea personajes con referencias para mantener consistencia visual</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-border bg-card/50 p-4 transition-colors hover:border-muted-foreground/20"
            >
              <h3 className="truncate text-[14px] font-medium text-foreground">{c.name}</h3>
              {c.description && (
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{c.description}</p>
              )}
              <p className="mt-1.5 text-[11px] text-muted-foreground/60">
                {c.reference_image_ids.length} referencia{c.reference_image_ids.length !== 1 ? 's' : ''}
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setEditing(c)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground">
                  <Pencil className="size-3" aria-hidden /> Editar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm(`Eliminar "${c.name}"?`)) return;
                    deleteCharacterAction(c.id).then((res) => {
                      if (res.ok) {
                        setCharacters((cs) => cs.filter((x) => x.id !== c.id));
                        toast.success('Personaje eliminado');
                      } else toast.error(res.message || 'Error');
                    });
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:border-destructive/40 hover:text-destructive"
                >
                  <Trash2 className="size-3" aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CharacterEditor({ character, onClose, onSaved }: { character: CharacterRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(character?.name ?? '');
  const [description, setDescription] = useState(character?.description ?? '');
  const [saving, startSave] = useTransition();

  function handleSave() {
    const payload = {
      name,
      description: description || undefined,
      referenceImageIds: character?.reference_image_ids ?? [],
    };
    startSave(async () => {
      const res = character
        ? await updateCharacterAction(character.id, payload)
        : await createCharacterAction(payload);
      if (!res.ok) { toast.error(res.message || 'Error'); return; }
      toast.success(character ? 'Personaje actualizado' : 'Personaje creado');
      onSaved();
    });
  }

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-5">
      <h2 className="text-[15px] font-medium text-foreground">{character ? 'Editar' : 'Nuevo'} Personaje</h2>
      <div className="mt-4 space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del personaje" className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción visual del personaje..." className="w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none" rows={3} />
        <p className="text-[11px] text-muted-foreground/60">Las imágenes de referencia se pueden agregar desde la biblioteca usando "Usar como referencia" en futuras versiones.</p>
        <div className="flex gap-2">
          <button type="button" onClick={handleSave} disabled={saving || !name.trim()} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-[13px] text-muted-foreground hover:bg-muted">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
