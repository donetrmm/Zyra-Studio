'use client';

import { useState } from 'react';
import { Loader2, Sparkles, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { getReferencePathsAction } from '@/server-actions/creation';
import { isGenError, type GeneratedImage, type GenError } from '@/components/creation/generate';

type RefineFn = (
  ref: { id: string; storagePath: string },
  instruction: string,
) => Promise<GeneratedImage | GenError>;

// Refinado iterativo con IA de la imagen maestra de un activo YA guardado
// (feedback 2026-07-04: antes solo el producto tenía edición iterativa; la
// maestra de personaje solo se podía editar durante la creación y la de
// locación nunca). Cada cambio produce una media_reference nueva que el editor
// padre adopta en su estado; se persiste con el Guardar normal del editor.
// "Deshacer" restaura la versión inmediatamente anterior (sin historial largo:
// el flujo es probar un cambio, quedárselo o volver).
export function MasterImageRefiner({
  image,
  refine,
  onResult,
  quickActions = [],
  placeholder = 'ej. luz más cálida',
}: {
  image: { id: string; previewUrl: string | null } | null;
  refine: RefineFn;
  onResult: (ref: { id: string; previewUrl: string | null }) => void;
  quickActions?: { label: string; instruction: string }[];
  placeholder?: string;
}) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [prev, setPrev] = useState<{ id: string; previewUrl: string | null } | null>(null);

  if (!image) return null;

  async function apply(text: string) {
    if (!image || text.trim().length < 3 || busy) return;
    setBusy(true);
    try {
      const pathsRes = await getReferencePathsAction([image.id]);
      const storagePath = pathsRes.ok ? pathsRes.data[image.id] : undefined;
      if (!storagePath) {
        toast.error('No se pudo resolver la imagen actual');
        return;
      }
      const out = await refine({ id: image.id, storagePath }, text.trim());
      if (isGenError(out)) {
        toast.error(out.message || 'No se pudo aplicar el cambio');
        return;
      }
      setPrev(image);
      onResult({ id: out.refId, previewUrl: out.previewUrl });
      setInstruction('');
      toast.success('Cambio aplicado; revisa la imagen y guarda');
    } finally {
      setBusy(false);
    }
  }

  function undo() {
    if (!prev) return;
    onResult(prev);
    setPrev(null);
    toast.success('Versión anterior restaurada');
  }

  return (
    <div>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Refinar con IA (un cambio por vez)
      </span>
      {quickActions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {quickActions.map((a) => (
            <button
              key={a.label}
              type="button"
              disabled={busy}
              onClick={() => void apply(a.instruction)}
              className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:opacity-50"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      <div className="mt-1.5 flex gap-2">
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void apply(instruction);
            }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <button
          type="button"
          onClick={() => void apply(instruction)}
          disabled={busy || instruction.trim().length < 3}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-[12.5px] font-medium text-foreground hover:bg-primary/15 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
          Aplicar
        </button>
        {prev && (
          <button
            type="button"
            onClick={undo}
            disabled={busy}
            title="Volver a la versión anterior"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[12.5px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <Undo2 className="size-3.5" aria-hidden />
            Deshacer
          </button>
        )}
      </div>
    </div>
  );
}
