'use client';

import { useState } from 'react';
import { Images, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { getReferencePoolAction, setReferenceSelectionAction } from '@/server-actions/campaigns';
// Type-only: reference-selection es módulo de server pero los tipos se borran al compilar.
import type { ReferencePoolCategory, ReferencePoolEntry } from '@/lib/campaigns/reference-selection';

type PoolEntry = ReferencePoolEntry & { thumbUrl: string | null };

// Tope de imágenes de referencia del modelo de video (Seedance R2V).
const MODEL_IMAGE_CAP = 9;

const CATEGORY_LABELS: Record<ReferencePoolCategory, string> = {
  product: 'Producto',
  packaging: 'Empaque',
  character_master: 'Cast — hojas maestras',
  character_angle: 'Cast — ángulos',
  location: 'Locación',
  scale_map: 'Mapa de escala',
  extra: 'Extras',
};

const CATEGORY_ORDER: ReferencePoolCategory[] = [
  'product',
  'packaging',
  'character_master',
  'character_angle',
  'location',
  'scale_map',
  'extra',
];

// Selector de referencias de video de la campaña: qué imágenes viajan al modelo
// (tope 9). null (automático) = recorte por prioridad actual. La selección se
// aplica al generar/regenerar video; los paneles de storyboard no la usan.
export function ReferencePoolDialog({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entries, setEntries] = useState<PoolEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // true = la campaña no tiene selección guardada (recorte automático).
  const [storedIsAuto, setStoredIsAuto] = useState(true);

  async function loadPool() {
    setLoading(true);
    const res = await getReferencePoolAction(campaignId);
    setLoading(false);
    if (!res.ok) {
      toast.error('No se pudo cargar el pool de referencias');
      setOpen(false);
      return;
    }
    setEntries(res.data.entries);
    const stored = res.data.include;
    setStoredIsAuto(stored === null);
    // Estado inicial: la selección guardada (+ masters, siempre viajan) o, en
    // automático, lo que el recorte por prioridad mandaría hoy.
    const init = new Set<string>(
      stored ?? res.data.entries.filter((e) => e.autoIncluded).map((e) => e.path),
    );
    for (const e of res.data.entries) if (e.locked) init.add(e.path);
    setSelected(init);
  }

  function toggle(entry: PoolEntry) {
    if (entry.locked) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    const res = await setReferenceSelectionAction({ campaignId, include: [...selected] });
    setSaving(false);
    if (res.ok) {
      setStoredIsAuto(false);
      toast.success('Selección de referencias guardada · aplica al generar o regenerar video');
      setOpen(false);
    } else {
      toast.error(res.message ?? 'No se pudo guardar la selección');
    }
  }

  async function handleReset() {
    setSaving(true);
    const res = await setReferenceSelectionAction({ campaignId, include: null });
    setSaving(false);
    if (res.ok) {
      toast.success('Selección restablecida al recorte automático');
      setOpen(false);
    } else {
      toast.error(res.message ?? 'No se pudo restablecer');
    }
  }

  const count = selected.size;
  const over = count - MODEL_IMAGE_CAP;
  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: entries.filter((e) => e.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void loadPool();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Images className="size-3.5" aria-hidden />
          Referencias
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Referencias del video</DialogTitle>
          <DialogDescription>
            Elige qué imágenes viajan al modelo al generar video (tope {MODEL_IMAGE_CAP} por clip).
            Las hojas maestras del cast siempre viajan: anclan la identidad. En automático, los
            ángulos del cast entran según el presupuesto del clip (menos personajes, más ángulos).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            <span className="text-[12.5px]">Cargando referencias…</span>
          </div>
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-[12.5px] text-muted-foreground">
            Esta campaña no tiene referencias de imagen (brand kit, cast o locaciones).
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {grouped.map(({ cat, items }) => (
              <div key={cat}>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_LABELS[cat]}
                </p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {items.map((e) => {
                    const on = selected.has(e.path);
                    return (
                      <button
                        key={e.path}
                        type="button"
                        onClick={() => toggle(e)}
                        aria-pressed={on}
                        disabled={e.locked}
                        title={e.locked ? `${e.label} · siempre viaja` : e.label}
                        className={`group relative aspect-square overflow-hidden rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                          on ? 'border-primary ring-1 ring-primary/40' : 'border-border opacity-55 hover:opacity-80'
                        } ${e.locked ? 'cursor-default' : ''}`}
                      >
                        {e.thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={e.thumbUrl} alt={e.label} loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center bg-muted/20 text-[10px] text-muted-foreground">
                            sin vista previa
                          </div>
                        )}
                        <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white/90">
                          {e.label}
                          {e.locked ? ' · siempre viaja' : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <p className={`text-[12px] ${over > 0 ? 'text-amber-400' : 'text-muted-foreground'}`}>
              {count} seleccionadas de {MODEL_IMAGE_CAP} que acepta el modelo
              {over > 0 &&
                ` — se recortarán ${over} por prioridad (producto, empaque, cast, locación, mapa, extras)`}
              {storedIsAuto && ' · hoy la campaña usa el recorte automático'}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="sm" disabled={saving || loading} onClick={handleReset}>
            <RotateCcw className="size-3.5" aria-hidden />
            Automático
          </Button>
          <Button type="button" size="sm" disabled={saving || loading || selected.size === 0} onClick={handleSave}>
            {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            Guardar selección
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
