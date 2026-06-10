'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { createCharacterAction, deleteCharacterAction, updateCharacterAction } from '@/server-actions/cast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ReferenceImagesUploader, type RefImage } from '@/components/shared/ReferenceImagesUploader';

export type CastCharacter = {
  id: string;
  name: string;
  description: string | null;
  master_image_id: string | null;
  angle_image_ids: string[];
};

export function CastPage({
  characters,
  previews,
}: {
  characters: CastCharacter[];
  previews: Record<string, string>;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<CastCharacter | 'new' | null>(null);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">Cast</h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
            Personajes consistentes para tus campañas. La hoja maestra (foto frontal, expresión neutra) se
            inyecta en cada generación donde aparece el personaje — misma cara en todos los videos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="size-4" aria-hidden />
          Nuevo personaje
        </button>
      </div>

      {editing && (
        <CharacterEditor
          character={editing === 'new' ? null : editing}
          previews={previews}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      )}

      {characters.length === 0 && !editing ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center text-muted-foreground/60">
          <div className="grid size-16 place-items-center rounded-2xl border border-border bg-muted/30">
            <Users className="size-7" aria-hidden />
          </div>
          <p className="text-[14px] text-foreground/70">Sin personajes en el Cast</p>
          <p className="max-w-sm text-[12.5px]">
            Los formatos con presentador (Voz Cercana, A Pie de Calle) necesitan al menos un personaje. Usa
            una imagen generada o estilizada — los rostros de personas reales están bloqueados por el modelo.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((c) => (
            <div key={c.id} className="overflow-hidden rounded-xl border border-border bg-card/50 transition-colors hover:border-muted-foreground/20">
              <div className="flex items-center gap-3 p-4">
                {c.master_image_id && previews[c.master_image_id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previews[c.master_image_id]} alt={c.name} className="size-14 shrink-0 rounded-full border border-border object-cover" />
                ) : (
                  <div className="grid size-14 shrink-0 place-items-center rounded-full border border-border bg-muted/30">
                    <Users className="size-5 text-muted-foreground/40" aria-hidden />
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="truncate text-[14px] font-medium text-foreground">{c.name}</h3>
                  {c.description && (
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted-foreground/70">{c.description}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2 border-t border-border/30 p-3">
                <button type="button" onClick={() => setEditing(c)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground">
                  <Pencil className="size-3" aria-hidden /> Editar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirm({ title: `Eliminar a "${c.name}"?`, description: 'Los items de campaña que lo usan quedarán sin personaje.', confirmLabel: 'Eliminar', destructive: true });
                    if (!ok) return;
                    const res = await deleteCharacterAction(c.id);
                    if (res.ok) { toast.success('Personaje eliminado'); router.refresh(); }
                    else toast.error(res.message || 'Error');
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

function CharacterEditor({
  character,
  previews,
  onClose,
  onSaved,
}: {
  character: CastCharacter | null;
  previews: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(character?.name ?? '');
  const [description, setDescription] = useState(character?.description ?? '');
  const [masterImages, setMasterImages] = useState<RefImage[]>(
    character?.master_image_id
      ? [{ id: character.master_image_id, previewUrl: previews[character.master_image_id] ?? null }]
      : [],
  );
  const [angleImages, setAngleImages] = useState<RefImage[]>(
    (character?.angle_image_ids ?? []).map((id) => ({ id, previewUrl: previews[id] ?? null })),
  );
  const [saving, startSave] = useTransition();

  const canSave = name.trim().length > 0 && masterImages.length === 1;

  function handleSave() {
    startSave(async () => {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        masterImageId: masterImages[0].id,
        angleImageIds: angleImages.map((i) => i.id),
      };
      const res = character
        ? await updateCharacterAction(character.id, payload)
        : await createCharacterAction(payload);
      if (!res.ok) { toast.error(res.message || 'Error'); return; }
      toast.success(character ? 'Personaje actualizado' : 'Personaje creado');
      onClose();
      onSaved();
    });
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-5 py-3.5">
        <h2 className="text-[15px] font-medium text-foreground">{character ? 'Editar' : 'Nuevo'} personaje</h2>
      </div>
      <div className="space-y-4 p-5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del personaje"
          maxLength={80}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/40"
        />

        <ReferenceImagesUploader
          label="Hoja maestra (obligatoria)"
          hint="Foto frontal, expresión neutra, buena luz, alta resolución. Sin rostros de personas reales."
          images={masterImages}
          onChange={(imgs) => setMasterImages(imgs.slice(-1))}
          max={1}
        />

        <ReferenceImagesUploader
          label="Ángulos adicionales"
          hint="Perfil y 3/4, opcionales — mejoran la consistencia."
          images={angleImages}
          onChange={setAngleImages}
          max={2}
        />

        <div>
          <label htmlFor="cast-desc" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Descripción
          </label>
          <textarea
            id="cast-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Apariencia, vestuario y manera de actuar (sin edad): creadora de pelo rizado oscuro, camisa de lino, entrega relajada y cercana…"
            rows={3}
            maxLength={600}
            className="mt-1.5 w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus:border-primary/40"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !canSave}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-[13px] text-muted-foreground hover:bg-muted">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
