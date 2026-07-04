'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MapPin, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  createLocationAction,
  deleteLocationAction,
  updateLocationAction,
} from '@/server-actions/locations';
import { submitGenerationAction } from '@/server-actions/generations';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import { getReferencePathsAction } from '@/server-actions/creation';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ReferenceImagesUploader, type RefImage } from '@/components/shared/ReferenceImagesUploader';
import { ZoomableImage } from '@/components/shared/ZoomableImage';
import { generateScaleMap, generateScaleMapFromMaster, isGenError } from '@/components/creation/generate';
import { buildLocationPrompt } from '@/lib/prompt-director/asset-prompts';
import { VisualStyleSelector } from '@/components/shared/VisualStyleSelector';
import type { VisualStyle } from '@/lib/prompt-director/style-profiles';

export type Location = {
  id: string;
  name: string;
  description: string | null;
  master_image_id: string | null;
  reference_image_ids: string[];
  scale_map_image_id: string | null;
  scale_map_notes: string | null;
};

export function LocationsPage({
  locations,
  previews,
  generateCost,
}: {
  locations: Location[];
  previews: Record<string, string>;
  // Costo en creditos de "Generar locacion con IA" (null si no se pudo cargar el pricing).
  generateCost: number | null;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Location | 'new' | null>(null);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">Locaciones</h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
            Escenarios reutilizables para tus campañas. La imagen maestra describe el lugar visualmente y
            se inyecta como referencia de ambiente en cada secuencia donde aparece la locación.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="size-4" aria-hidden />
          Nueva locación
        </button>
      </div>

      {editing && (
        <LocationEditor
          location={editing === 'new' ? null : editing}
          previews={previews}
          generateCost={generateCost}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      )}

      {locations.length === 0 && !editing ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center text-muted-foreground/60">
          <div className="grid size-16 place-items-center rounded-2xl border border-border bg-muted/30">
            <MapPin className="size-7" aria-hidden />
          </div>
          <p className="text-[14px] text-foreground/70">Sin locaciones</p>
          <p className="max-w-sm text-[12.5px]">
            Las locaciones definen el &ldquo;dónde&rdquo; de cada secuencia. Añade una imagen de referencia
            del lugar para que el modelo lo recree con consistencia.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map((l) => (
            <div
              key={l.id}
              className="overflow-hidden rounded-xl border border-border bg-card/50 transition-colors hover:border-muted-foreground/20"
            >
              <div className="flex items-center gap-3 p-4">
                {l.master_image_id && previews[l.master_image_id] ? (
                  <ZoomableImage src={previews[l.master_image_id]} alt={l.name} className="size-14 shrink-0 rounded-lg border border-border" />
                ) : (
                  <div className="grid size-14 shrink-0 place-items-center rounded-lg border border-border bg-muted/30">
                    <MapPin className="size-5 text-muted-foreground/40" aria-hidden />
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="truncate text-[14px] font-medium text-foreground">{l.name}</h3>
                  {l.description && (
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted-foreground/70">
                      {l.description}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2 border-t border-border/30 p-3">
                <button
                  type="button"
                  onClick={() => setEditing(l)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="size-3" aria-hidden /> Editar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Eliminar "${l.name}"?`,
                      description: 'Los items de campaña que la usan quedarán sin locación.',
                      confirmLabel: 'Eliminar',
                      destructive: true,
                    });
                    if (!ok) return;
                    const res = await deleteLocationAction(l.id);
                    if (res.ok) {
                      toast.success('Locación eliminada');
                      router.refresh();
                    } else {
                      toast.error(res.message || 'Error');
                    }
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

function LocationEditor({
  location,
  previews,
  generateCost,
  onClose,
  onSaved,
}: {
  location: Location | null;
  previews: Record<string, string>;
  generateCost: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(location?.name ?? '');
  const [description, setDescription] = useState(location?.description ?? '');
  const [masterImages, setMasterImages] = useState<RefImage[]>(
    location?.master_image_id
      ? [{ id: location.master_image_id, previewUrl: previews[location.master_image_id] ?? null }]
      : [],
  );
  const [referenceImages, setReferenceImages] = useState<RefImage[]>(
    (location?.reference_image_ids ?? []).map((id) => ({ id, previewUrl: previews[id] ?? null })),
  );
  const [saving, startSave] = useTransition();
  const [generating, setGenerating] = useState(false);
  const [visualStyle, setVisualStyle] = useState<VisualStyle>('ultra_realista');
  const [visualStyleCustom, setVisualStyleCustom] = useState('');
  const [scaleMapImages, setScaleMapImages] = useState<RefImage[]>(
    location?.scale_map_image_id
      ? [{ id: location.scale_map_image_id, previewUrl: previews[location.scale_map_image_id] ?? null }]
      : [],
  );
  const [scaleMapNotes, setScaleMapNotes] = useState(location?.scale_map_notes ?? '');
  const [generatingMap, setGeneratingMap] = useState(false);
  // Con maestra basta la maestra; sin maestra hace falta descripción (FLUX desde texto).
  const canGenerateMap = (masterImages.length > 0 || description.trim().length >= 10) && !generatingMap;

  async function handleGenerateScaleMap() {
    if (!canGenerateMap) return;
    setGeneratingMap(true);
    try {
      // Si hay imagen maestra, el plano se DERIVA de ella (Nano Banana la redibuja
      // como top-down respetando los elementos reales). Sin maestra, FLUX desde texto.
      const masterId = masterImages[0]?.id;
      let out;
      if (masterId) {
        const pathsRes = await getReferencePathsAction([masterId]);
        const storagePath = pathsRes.ok ? pathsRes.data[masterId] : undefined;
        if (!storagePath) {
          toast.error('No se pudo resolver la imagen maestra');
          return;
        }
        out = await generateScaleMapFromMaster({ id: masterId, storagePath }, description.trim() || undefined);
      } else {
        out = await generateScaleMap(description.trim());
      }
      if (isGenError(out)) {
        toast.error(out.message || 'No se pudo generar el mapa de escala');
        return;
      }
      setScaleMapImages([{ id: out.refId, previewUrl: out.previewUrl }]);
      toast.success('Mapa de escala generado; revísalo y guarda');
    } finally {
      setGeneratingMap(false);
    }
  }

  // Master es opcional en locaciones — solo nombre requerido.
  const canSave = name.trim().length > 0;
  const canGenerate =
    description.trim().length >= 10 &&
    !generating &&
    (visualStyle !== 'custom' || visualStyleCustom.trim().length >= 3);

  async function handleGenerateMaster() {
    if (!canGenerate) return;
    setGenerating(true);
    try {
      const res = await submitGenerationAction({
        provider: 'flux' as const,
        model: 'flux-2-pro-preview' as const,
        variant: 'default' as const,
        prompt: buildLocationPrompt(
          description.trim(),
          visualStyle,
          visualStyle === 'custom' ? visualStyleCustom.trim() : undefined,
        ),
        aspectRatio: '16:9' as const,
        megapixels: 2 as const,
        // Solo ultra_realista: la PHOTOREAL_DIRECTIVE de FLUX (cámara full-frame)
        // contradiría el bloque smartphone del estilo 'casero'.
        photoreal: visualStyle === 'ultra_realista',
        references: [],
      });
      if (!res.ok) {
        toast.error(
          res.error === 'insufficient_credits'
            ? 'Créditos insuficientes para generar la locación'
            : res.message || 'No se pudo generar',
        );
        return;
      }
      // La imagen se copia al bucket de referencias y queda como media_reference.
      const ref = await addGenerationAsReferenceAction({ generationId: res.data.generationId });
      if (!ref.ok) {
        toast.error(ref.message || 'Se generó la imagen pero no se pudo fijar; búscala en la librería');
        return;
      }
      setMasterImages([{ id: ref.data.id, previewUrl: ref.data.previewUrl || null }]);
      toast.success('Locación generada; revisa que represente el lugar y guarda');
    } finally {
      setGenerating(false);
    }
  }

  function handleSave() {
    startSave(async () => {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        masterImageId: masterImages[0]?.id,
        referenceImageIds: referenceImages.map((i) => i.id),
        scaleMapImageId: scaleMapImages[0]?.id,
        scaleMapNotes: scaleMapNotes.trim() || undefined,
      };
      const res = location
        ? await updateLocationAction(location.id, payload)
        : await createLocationAction(payload);
      if (!res.ok) {
        toast.error(res.message || 'Error');
        return;
      }
      toast.success(location ? 'Locación actualizada' : 'Locación creada');
      onClose();
      onSaved();
    });
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-5 py-3.5">
        <h2 className="text-[15px] font-medium text-foreground">
          {location ? 'Editar' : 'Nueva'} locación
        </h2>
      </div>
      <div className="space-y-4 p-5">
        <input
          id="location-name"
          aria-label="Nombre de la locación"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre de la locación"
          maxLength={80}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        />

        <div>
          <label
            htmlFor="location-desc"
            className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Descripción (opcional)
          </label>
          <textarea
            id="location-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ambiente, luz, estilo arquitectónico, época: café de barrio con luz cálida, mesas de madera, ventana a la calle…"
            rows={3}
            maxLength={600}
            className="mt-1.5 w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>

        <ReferenceImagesUploader
          label="Imagen maestra (opcional)"
          hint="Vista representativa del lugar: exterior, interior, plano general. Alta resolución."
          images={masterImages}
          onChange={(imgs) => setMasterImages(imgs.slice(-1))}
          max={1}
        />

        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            ¿Sin foto del lugar? Genera la imagen de la locación con IA a partir de la descripción.
          </p>
          <div className="mb-2">
            <VisualStyleSelector
              compact
              value={visualStyle}
              customText={visualStyleCustom}
              onValueChange={setVisualStyle}
              onCustomTextChange={setVisualStyleCustom}
            />
          </div>
          <button
            type="button"
            onClick={handleGenerateMaster}
            disabled={!canGenerate}
            title={
              description.trim().length < 10
                ? 'Escribe una descripción (mín. 10 caracteres)'
                : visualStyle === 'custom' && visualStyleCustom.trim().length < 3
                  ? 'Describe el estilo personalizado (mínimo 3 caracteres)'
                  : undefined
            }
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary/30 px-3 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {generating ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-3.5" aria-hidden />
            )}
            {generating
              ? 'Generando…'
              : `Generar locación con IA${generateCost != null ? ` · −${generateCost} cr` : ''}`}
          </button>
        </div>

        <ReferenceImagesUploader
          label="Imágenes de referencia adicionales"
          hint="Detalles, ángulos o momentos del día distintos. Hasta 4 imágenes."
          images={referenceImages}
          onChange={setReferenceImages}
          max={4}
        />

        <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-4">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Mapa de escala (opcional)
            </h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground/70">
              Esquema top-down que fija el tamaño y la posición de los objetos (evita que cambien de
              tamaño o se muevan entre tomas). Súbelo o genéralo: si hay imagen maestra, se redibuja a
              partir de ella; si no, desde la descripción.
            </p>
          </div>

          {scaleMapImages[0]?.previewUrl ? (
            <ZoomableImage
              src={scaleMapImages[0].previewUrl}
              alt="Mapa de escala"
              className="size-24 rounded-md border border-border"
            />
          ) : null}

          <ReferenceImagesUploader
            label="Imagen del mapa"
            hint="Diagrama visto desde arriba con proporciones marcadas. Opcional."
            images={scaleMapImages}
            onChange={(imgs) => setScaleMapImages(imgs.slice(-1))}
            max={1}
          />

          <button
            type="button"
            onClick={handleGenerateScaleMap}
            disabled={!canGenerateMap}
            title={masterImages.length === 0 && description.trim().length < 10 ? 'Sube una imagen maestra o escribe una descripción (mín. 10 caracteres)' : undefined}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 px-3 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {generatingMap ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-3.5" aria-hidden />
            )}
            {generatingMap ? 'Generando…' : `Generar mapa con IA${generateCost != null ? ` · −${generateCost} cr` : ''}`}
          </button>

          <div>
            <label htmlFor="scale-map-notes" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Notas de proporciones (opcional)
            </label>
            <textarea
              id="scale-map-notes"
              value={scaleMapNotes}
              onChange={(e) => setScaleMapNotes(e.target.value)}
              placeholder="p. ej. la mascota mide 2× el humano, a la izquierda de la puerta"
              rows={2}
              maxLength={300}
              className="mt-1.5 w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
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
