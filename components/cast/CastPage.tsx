'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil, Plus, Sparkles, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { createCharacterAction, deleteCharacterAction, describeCharacterAction, updateCharacterAction } from '@/server-actions/cast';
import { createCharacterStateAction, listCharacterStatesAction, deleteCharacterStateAction } from '@/server-actions/character-states';
import { getReferencePathsAction } from '@/server-actions/creation';
import { submitGenerationAction } from '@/server-actions/generations';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import { generateCharacterState, isGenError } from '@/components/creation/generate';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ReferenceImagesUploader, type RefImage } from '@/components/shared/ReferenceImagesUploader';
import { CreationWizard } from '@/components/creation/CreationWizard';

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
  fluxCost,
}: {
  characters: CastCharacter[];
  previews: Record<string, string>;
  fluxCost: number;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<CastCharacter | 'new' | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

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
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="inline-flex shrink-0 items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3.5 py-2 text-[13px] font-medium text-foreground hover:bg-primary/15"
          >
            <Sparkles className="size-4" aria-hidden /> Crear con IA
          </button>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="size-4" aria-hidden />
            Nuevo personaje
          </button>
        </div>
      </div>

      {editing && (
        <CharacterEditor
          character={editing === 'new' ? null : editing}
          previews={previews}
          fluxCost={fluxCost}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      )}

      {aiOpen && (
        <CreationWizard
          kind="character"
          onSave={async (result) => {
            if (result.kind !== 'character') return;
            const res = await createCharacterAction({
              name: 'Nuevo personaje',
              masterImageId: result.refId,
              angleImageIds: result.angleRefIds.slice(0, 2),
            });
            if (!res.ok) { toast.error(res.message || 'No se pudo crear'); return; }
            router.refresh();
          }}
          onClose={() => setAiOpen(false)}
        />
      )}

      {characters.length === 0 && !editing ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center text-muted-foreground">
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
                  <img src={previews[c.master_image_id]} alt={c.name} width={56} height={56} loading="lazy" decoding="async" className="size-14 shrink-0 rounded-full border border-border object-cover" />
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
                  aria-label="Eliminar personaje"
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

// Prompt de hoja maestra (doc V2 §4.4 + spec D tarea 2): retrato frontal
// neutro de una persona ficticia, luz pareja — los criterios de calidad de
// referencia que el Prompt Director espera. Concreto, sin slop.
function buildMasterPrompt(description: string): string {
  return (
    `Frontal head-and-shoulders portrait of a fictional person: ${description}. ` +
    'Neutral relaxed expression, looking straight at the camera, soft even studio lighting, ' +
    'plain light gray seamless background, sharp focus on the face, natural skin texture, ' +
    'no text, no watermark.'
  );
}

type CharacterState = { id: string; label: string; stateImageId: string | null; description: string | null };

function CharacterEditor({
  character,
  previews,
  fluxCost,
  onClose,
  onSaved,
}: {
  character: CastCharacter | null;
  previews: Record<string, string>;
  fluxCost: number;
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
  const [generating, setGenerating] = useState(false);
  const [describing, setDescribing] = useState(false);

  // Estados (only for existing characters with a master image)
  const [states, setStates] = useState<CharacterState[]>([]);
  const [statesLoaded, setStatesLoaded] = useState(false);
  const [stateLabel, setStateLabel] = useState('');
  const [stateDesc, setStateDesc] = useState('');
  const [bakingState, setBakingState] = useState(false);

  useEffect(() => {
    if (!character?.id) return;
    listCharacterStatesAction(character.id).then((res) => {
      if (res.ok) setStates(res.data);
      setStatesLoaded(true);
    });
  }, [character?.id]);

  async function handleBakeState() {
    if (!character?.id || !character.master_image_id) return;
    if (!stateLabel.trim()) { toast.error('Escribe una etiqueta para el estado'); return; }
    if (!stateDesc.trim()) { toast.error('Describe el estado físico'); return; }
    setBakingState(true);
    try {
      const pathsRes = await getReferencePathsAction([character.master_image_id]);
      if (!pathsRes.ok) { toast.error(pathsRes.message || 'No se pudo resolver la imagen maestra'); return; }
      const storagePath = pathsRes.data[character.master_image_id];
      if (!storagePath) { toast.error('La hoja maestra no tiene ruta de almacenamiento'); return; }
      const out = await generateCharacterState({ id: character.master_image_id, storagePath }, stateDesc.trim());
      if (isGenError(out)) { toast.error(out.message || 'No se pudo generar el estado'); return; }
      const saveRes = await createCharacterStateAction({
        characterId: character.id,
        label: stateLabel.trim(),
        stateImageId: out.refId,
        description: stateDesc.trim(),
      });
      if (!saveRes.ok) { toast.error(saveRes.message || 'No se pudo guardar el estado'); return; }
      toast.success('Estado generado y guardado');
      setStateLabel('');
      setStateDesc('');
      const refreshRes = await listCharacterStatesAction(character.id);
      if (refreshRes.ok) setStates(refreshRes.data);
    } finally {
      setBakingState(false);
    }
  }

  async function handleDeleteState(id: string) {
    const res = await deleteCharacterStateAction(id);
    if (!res.ok) { toast.error(res.message || 'No se pudo borrar el estado'); return; }
    setStates((prev) => prev.filter((s) => s.id !== id));
  }

  const canSave = name.trim().length > 0 && masterImages.length === 1;
  const canGenerate = description.trim().length >= 10 && !generating;
  const canDescribe = masterImages.length === 1 && !describing;

  async function handleDescribe() {
    if (!canDescribe) return;
    setDescribing(true);
    try {
      const res = await describeCharacterAction(masterImages[0].id);
      if (!res.ok) {
        toast.error(res.message || 'No se pudo describir la imagen');
        return;
      }
      setDescription(res.data.description);
      toast.success('Descripción sugerida desde la imagen; ajústala si quieres');
    } finally {
      setDescribing(false);
    }
  }

  async function handleGenerateMaster() {
    if (!canGenerate) return;
    setGenerating(true);
    try {
      const res = await submitGenerationAction({
        provider: 'flux' as const,
        model: 'flux-2-pro-preview' as const,
        variant: 'default' as const,
        prompt: buildMasterPrompt(description.trim()),
        aspectRatio: '3:4' as const,
        megapixels: 2 as const,
        photoreal: true,
        references: [],
      });
      if (!res.ok) {
        toast.error(
          res.error === 'insufficient_credits'
            ? 'Créditos insuficientes para generar la hoja maestra'
            : res.message || 'No se pudo generar',
        );
        return;
      }
      // El retrato se copia al bucket de referencias y queda como media_reference.
      const ref = await addGenerationAsReferenceAction({ generationId: res.data.generationId });
      if (!ref.ok) {
        toast.error(ref.message || 'Se generó la imagen pero no se pudo fijar como hoja maestra; búscala en la librería');
        return;
      }
      setMasterImages([{ id: ref.data.id, previewUrl: ref.data.previewUrl || null }]);
      toast.success('Hoja maestra generada; revisa que represente al personaje y guarda');
    } finally {
      setGenerating(false);
    }
  }

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
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        />

        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="cast-desc" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Descripción
            </label>
            <button
              type="button"
              onClick={handleDescribe}
              disabled={!canDescribe}
              title={masterImages.length !== 1 ? 'Sube o genera primero la hoja maestra' : undefined}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {describing ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="size-3" aria-hidden />
              )}
              {describing ? 'Analizando…' : 'Describir desde la imagen'}
            </button>
          </div>
          <textarea
            id="cast-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Apariencia, vestuario y manera de actuar (sin edad): creadora de pelo rizado oscuro, camisa de lino, entrega relajada y cercana…"
            rows={3}
            maxLength={600}
            className="mt-1.5 w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>

        <ReferenceImagesUploader
          label="Hoja maestra (obligatoria)"
          hint="Foto frontal, expresión neutra, buena luz, alta resolución. Sin rostros de personas reales."
          images={masterImages}
          onChange={(imgs) => setMasterImages(imgs.slice(-1))}
          max={1}
        />

        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Sin foto que puedas usar? Genera la hoja maestra con IA a partir de la descripción —
            el personaje será 100% ficticio, lo que evita el bloqueo de rostros reales del modelo de video.
          </p>
          <button
            type="button"
            onClick={handleGenerateMaster}
            disabled={!canGenerate}
            title={
              description.trim().length < 10
                ? 'Escribe primero la descripción del personaje'
                : undefined
            }
            className="mt-2 inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-3.5 text-primary" aria-hidden />
            )}
            {generating
              ? 'Generando retrato…'
              : `Generar con IA${fluxCost > 0 ? ` · ${fluxCost} cr` : ''}`}
          </button>
        </div>

        <ReferenceImagesUploader
          label="Ángulos adicionales"
          hint="Perfil y 3/4, opcionales — mejoran la consistencia."
          images={angleImages}
          onChange={setAngleImages}
          max={2}
        />

        {character?.master_image_id && (
          <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Estados (opcional)
              </h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground/70">
                Variantes físicas del personaje (mojado, sudado, etc.) generadas desde la hoja maestra.
              </p>
            </div>

            {statesLoaded && states.length > 0 && (
              <ul className="space-y-1.5">
                {states.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
                    <div className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-foreground">{s.label}</span>
                      {s.description && (
                        <span className="block truncate text-[11.5px] text-muted-foreground/70">{s.description}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteState(s.id)}
                      className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:border-destructive/40 hover:text-destructive"
                      title="Borrar estado"
                    >
                      <Trash2 className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {statesLoaded && states.length === 0 && (
              <p className="text-[12px] text-muted-foreground">Sin estados guardados.</p>
            )}

            <div className="space-y-2">
              <input
                value={stateLabel}
                onChange={(e) => setStateLabel(e.target.value)}
                placeholder="Etiqueta (ej. Mojado)"
                maxLength={40}
                disabled={bakingState}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
              />
              <input
                value={stateDesc}
                onChange={(e) => setStateDesc(e.target.value)}
                placeholder="Descripción del estado (ej. wet hair and soaked clothing, sweat on the forehead)"
                maxLength={300}
                disabled={bakingState}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleBakeState}
                disabled={bakingState || !stateLabel.trim() || !stateDesc.trim()}
                className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {bakingState ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="size-3.5 text-primary" aria-hidden />
                )}
                {bakingState ? 'Generando estado…' : 'Generar estado'}
              </button>
            </div>
          </div>
        )}

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
