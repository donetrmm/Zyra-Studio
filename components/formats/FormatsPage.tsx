'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Clapperboard, Loader2, Lock, Pencil, Plus, Trash2, Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { createFormatAction, deleteFormatAction, updateFormatAction } from '@/server-actions/formats';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';

export type FormatRowUi = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  register: string | null;
  cameraStyle: string | null;
  pacing: string | null;
  requiredRefs: string[];
  defaultDurationS: number;
  defaultAudio: boolean;
  isSystem: boolean;
};

const REF_LABEL: Record<string, string> = {
  product: 'producto',
  character: 'personaje',
  packaging: 'empaque',
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function FormatsPage({ formats }: { formats: FormatRowUi[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<FormatRowUi | 'new' | null>(null);

  const system = formats.filter((f) => f.isSystem);
  const custom = formats.filter((f) => !f.isSystem);

  async function handleDelete(f: FormatRowUi) {
    const ok = await confirm({
      title: `Eliminar el formato "${f.name}"?`,
      description: 'Las campañas nuevas dejarán de proponerlo.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    const res = await deleteFormatAction(f.id);
    if (res.ok) {
      toast.success('Formato eliminado');
      router.refresh();
    } else toast.error(res.message || 'Error');
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">Formatos creativos</h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
            Cada formato define registro, cámara, ritmo y qué referencias exige. Los de sistema son el
            punto de partida; crea los tuyos y el planner los incluirá en el mix de tus campañas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="size-4" aria-hidden />
          Nuevo formato
        </button>
      </div>

      {editing && (
        <FormatEditor
          format={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      )}

      {custom.length > 0 && (
        <>
          <h2 className="mt-8 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            Tus formatos
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {custom.map((f) => (
              <FormatCard key={f.id} format={f} onEdit={() => setEditing(f)} onDelete={() => handleDelete(f)} />
            ))}
          </div>
        </>
      )}

      <h2 className="mt-8 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
        Formatos 1to1
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {system.map((f) => (
          <FormatCard key={f.id} format={f} />
        ))}
      </div>
    </div>
  );
}

function FormatCard({
  format,
  onEdit,
  onDelete,
}: {
  format: FormatRowUi;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 transition-colors hover:border-muted-foreground/20">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-muted/30">
            <Clapperboard className="size-4 text-muted-foreground/60" aria-hidden />
          </div>
          <div>
            <h3 className="text-[14px] font-medium text-foreground">{format.name}</h3>
            <p className="font-mono text-[11px] text-muted-foreground/50">{format.slug}</p>
          </div>
        </div>
        {format.isSystem ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground/60">
            <Lock className="size-2.5" aria-hidden /> sistema
          </span>
        ) : (
          <span className="inline-flex gap-1">
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Editar ${format.name}`}
              className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            >
              <Pencil className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Eliminar ${format.name}`}
              className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-destructive"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </span>
        )}
      </div>

      {format.description && (
        <p className="mt-2.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground/80">
          {format.description}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground/70">
          {format.defaultDurationS}s
        </span>
        {format.defaultAudio && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-muted-foreground/70">
            <Volume2 className="size-2.5" aria-hidden /> audio
          </span>
        )}
        {format.requiredRefs.map((r) => (
          <span key={r} className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-primary/80">
            requiere {REF_LABEL[r] ?? r}
          </span>
        ))}
      </div>
    </div>
  );
}

function FormatEditor({
  format,
  onClose,
  onSaved,
}: {
  format: FormatRowUi | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(format?.name ?? '');
  const [slug, setSlug] = useState(format?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(!!format);
  const [description, setDescription] = useState(format?.description ?? '');
  const [register, setRegister] = useState(format?.register ?? '');
  const [cameraStyle, setCameraStyle] = useState(format?.cameraStyle ?? '');
  const [pacing, setPacing] = useState(format?.pacing ?? '');
  const [requiredRefs, setRequiredRefs] = useState<string[]>(format?.requiredRefs ?? []);
  const [durationS, setDurationS] = useState(format?.defaultDurationS ?? 8);
  const [audio, setAudio] = useState(format?.defaultAudio ?? true);
  const [saving, startSave] = useTransition();

  const canSave = name.trim().length > 0 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);

  function toggleRef(r: string) {
    setRequiredRefs((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  function handleSave() {
    startSave(async () => {
      const payload = {
        slug,
        name: name.trim(),
        description: description.trim() || undefined,
        register: register.trim() || undefined,
        cameraStyle: cameraStyle.trim() || undefined,
        pacing: pacing.trim() || undefined,
        requiredRefs,
        defaultDurationS: durationS,
        defaultAudio: audio,
      };
      const res = format
        ? await updateFormatAction(format.id, payload)
        : await createFormatAction(payload);
      if (!res.ok) {
        toast.error(res.message || 'Error');
        return;
      }
      toast.success(format ? 'Formato actualizado' : 'Formato creado');
      onClose();
      onSaved();
    });
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-5 py-3.5">
        <h2 className="text-[15px] font-medium text-foreground">
          {format ? 'Editar' : 'Nuevo'} formato
        </h2>
      </div>
      <div className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="fmt-name" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Nombre
            </label>
            <input
              id="fmt-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              placeholder="El Contraste"
              maxLength={80}
              className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <label htmlFor="fmt-slug" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Slug
            </label>
            <input
              id="fmt-slug"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              placeholder="el-contraste"
              maxLength={60}
              className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-[12.5px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
        </div>

        <div>
          <label htmlFor="fmt-desc" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Descripción
          </label>
          <textarea
            id="fmt-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Qué es y cuándo usarlo"
            rows={2}
            maxLength={500}
            className="mt-1.5 w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="fmt-register" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Registro
            </label>
            <input
              id="fmt-register"
              value={register}
              onChange={(e) => setRegister(e.target.value)}
              placeholder="documental cercano, voz casual"
              maxLength={300}
              className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[12.5px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <label htmlFor="fmt-camera" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Cámara
            </label>
            <input
              id="fmt-camera"
              value={cameraStyle}
              onChange={(e) => setCameraStyle(e.target.value)}
              placeholder="handheld a nivel de ojos"
              maxLength={300}
              className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[12.5px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <label htmlFor="fmt-pacing" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Ritmo
            </label>
            <input
              id="fmt-pacing"
              value={pacing}
              onChange={(e) => setPacing(e.target.value)}
              placeholder="cortes rápidos al inicio, cierre quieto"
              maxLength={200}
              className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[12.5px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Referencias obligatorias
          </div>
          <div className="mt-1.5 flex gap-2">
            {(['product', 'character', 'packaging'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => toggleRef(r)}
                className={cn(
                  'rounded-full border px-3 py-1 text-[12px] transition-colors',
                  requiredRefs.includes(r)
                    ? 'border-primary/50 bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                )}
              >
                {REF_LABEL[r]}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground/60">
            El planner solo propone el formato si el Brand Kit/Cast puede cumplirlas.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Duración default
              </span>
              <span className="font-mono text-[12px] text-foreground">{durationS}s</span>
            </div>
            <input
              type="range"
              min={4}
              max={15}
              step={1}
              value={durationS}
              onChange={(e) => setDurationS(Number(e.target.value))}
              className="mt-2 w-full accent-primary"
              aria-label="Duración default en segundos"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setAudio(!audio)}
              className={cn(
                'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-[12.5px] transition-colors',
                audio
                  ? 'border-primary/40 bg-primary/5 text-foreground'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/40',
              )}
            >
              <Volume2 className={cn('size-4', audio && 'text-primary')} aria-hidden />
              Audio nativo por default
            </button>
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
