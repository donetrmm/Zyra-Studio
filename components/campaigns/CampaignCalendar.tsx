'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { buildImagePackAction, updateItemScheduleAction } from '@/server-actions/campaigns';
import { submitGenerationAction } from '@/server-actions/generations';
import { estimateCredits } from '@/lib/credits/estimator';
import type { PricingRow } from '@/lib/credits/types';
import type { StudioItem } from './studio/types';
import { insufficientCreditsToast } from './credits-toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// Etiquetas legibles para fallos no-crédito al generar/refinar el pack.
const GEN_ERROR_LABEL: Record<string, string> = {
  safety: 'política de contenido',
  provider_error: 'error del proveedor',
  validation_error: 'datos inválidos',
  forbidden: 'sin permiso',
  internal_error: 'error interno',
};

function genErrorReason(res: { error: string; message?: string }): string {
  return GEN_ERROR_LABEL[res.error] ?? res.message ?? 'error desconocido';
}

// ============ Pack de imágenes (specs/v2/05 tarea 5) ============
// El server arma los prompts (FLUX + escenas ganadoras); el cliente genera
// una imagen por llamada con el flujo normal — cada una se cobra y cae en
// la librería de la campaña.
export function ImagePackCard({ campaignId, pricing }: { campaignId: string; pricing: PricingRow[] }) {
  const [count, setCount] = useState<4 | 6 | 8>(4);
  // Costo estimado por imagen del pack (FLUX 1 megapixel). El bonus por imágenes de
  // referencia (que arma el server) lo sumará la deducción real -> por eso es un "~".
  let packUnit: number | null = null;
  try {
    packUnit = estimateCredits(pricing, {
      provider: 'flux',
      model: 'flux-2-pro-preview',
      variant: 'default',
      params: { megapixels: 1, references: 0 },
    }).total;
  } catch {
    packUnit = null;
  }
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [generated, setGenerated] = useState<Array<{ id: string; aspectRatio: string }>>([]);
  const [refineText, setRefineText] = useState(
    'Ajusta el fondo: más limpio y consistente con la marca. Mantén el producto y la composición idénticos.',
  );
  const [refining, setRefining] = useState<{ done: number; total: number } | null>(null);

  async function handlePack() {
    const plan = await buildImagePackAction(campaignId, count);
    if (!plan.ok) {
      toast.error(plan.message ?? 'No se pudo armar el pack');
      return;
    }
    const { specs, references } = plan.data;
    setProgress({ done: 0, total: specs.length });
    setGenerated([]);
    const created: Array<{ id: string; aspectRatio: string }> = [];
    let ok = 0;
    let fail = 0;
    let lastReason: string | null = null;
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const res = await submitGenerationAction({
        provider: 'flux',
        model: 'flux-2-pro-preview',
        variant: 'default',
        prompt: spec.prompt,
        aspectRatio: spec.aspectRatio,
        megapixels: 1,
        references,
        photoreal: true,
        campaignId,
      });
      if (res.ok) {
        ok += 1;
        created.push({ id: res.data.generationId, aspectRatio: spec.aspectRatio });
      } else if (res.error === 'insufficient_credits') {
        insufficientCreditsToast('Créditos insuficientes; pack detenido');
        break;
      } else {
        fail += 1;
        lastReason = genErrorReason(res);
      }
      setProgress({ done: i + 1, total: specs.length });
    }
    setProgress(null);
    setGenerated(created);
    if (ok > 0) {
      toast.success(`Pack listo: ${ok} ${ok === 1 ? 'imagen' : 'imágenes'} en la librería de la campaña`);
    }
    if (fail > 0) {
      const reason = lastReason ? `: ${lastReason}` : '';
      toast.error(`${fail} ${fail === 1 ? 'imagen no se generó' : 'imágenes no se generaron'}${reason}`);
    }
  }

  // Refinamiento con Nano Banana (specs/v2/05 tarea 5): edición conversacional
  // sobre cada imagen del pack — un cambio por iteración, todo lo demás igual.
  async function handleRefine() {
    if (!generated.length || !refineText.trim()) return;
    setRefining({ done: 0, total: generated.length });
    let ok = 0;
    let fail = 0;
    let lastReason: string | null = null;
    for (let i = 0; i < generated.length; i++) {
      const g = generated[i];
      const res = await submitGenerationAction({
        provider: 'nano-banana',
        model: 'gemini-3-pro-image-preview',
        variant: '1k',
        prompt: refineText.trim(),
        aspectRatio: g.aspectRatio,
        references: [],
        conversational: true,
        parentGenerationId: g.id,
        campaignId,
      });
      if (res.ok) ok += 1;
      else if (res.error === 'insufficient_credits') {
        insufficientCreditsToast('Créditos insuficientes; refinado detenido');
        break;
      } else {
        fail += 1;
        lastReason = genErrorReason(res);
      }
      setRefining({ done: i + 1, total: generated.length });
    }
    setRefining(null);
    if (ok > 0) {
      toast.success(`${ok} ${ok === 1 ? 'imagen refinada' : 'imágenes refinadas'} en la librería de la campaña`);
      setGenerated([]);
    }
    if (fail > 0) {
      const reason = lastReason ? `: ${lastReason}` : '';
      toast.error(`${fail} ${fail === 1 ? 'imagen no se refinó' : 'imágenes no se refinaron'}${reason}`);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-lg bg-muted/40">
            <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
          </div>
          <div>
            <p className="text-[13.5px] font-medium text-foreground">Pack de imágenes</p>
            <p className="max-w-md text-[11.5px] text-muted-foreground">
              Posts 1:1 de las escenas ganadoras, banners 16:9 con espacio limpio para copy y stills de
              producto (FLUX; el copy va en el caption, no quemado en la imagen)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Cantidad de imágenes del pack" className="flex items-center gap-2">
            {([4, 6, 8] as const).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={count === n}
                aria-label={`${n} imágenes`}
                onClick={() => setCount(n)}
                disabled={progress !== null}
                className={`rounded-md border px-2.5 py-1 text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 ${
                  count === n
                    ? 'border-primary/60 bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={progress !== null}
            onClick={handlePack}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
          >
            {progress ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {progress.done}/{progress.total}
              </>
            ) : (
              <>
                <Play className="size-3.5" aria-hidden />
                Generar pack
                {packUnit != null && <span className="text-primary-foreground/80">· ~{packUnit * count} cr</span>}
              </>
            )}
          </button>
        </div>
      </div>

      {generated.length > 0 && !progress && (
        <div className="mt-3 border-t border-border/50 pt-3">
          <p className="text-[12.5px] font-medium text-foreground">
            Refinar con Nano Banana <span className="text-muted-foreground">({generated.length} imágenes)</span>
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Un cambio por iteración: describe el ajuste y se aplica a cada imagen del pack conservando
            todo lo demás.
          </p>
          <Textarea
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            rows={2}
            maxLength={500}
            aria-label="Instrucción de refinamiento"
            className="mt-2 resize-none text-[12.5px]"
          />
          <button
            type="button"
            disabled={refining !== null || !refineText.trim()}
            onClick={handleRefine}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12.5px] font-medium text-foreground outline-none transition-colors hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
          >
            {refining ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {refining.done}/{refining.total}
              </>
            ) : (
              'Refinar el pack'
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ============ Calendario (specs/v2/05 tarea 1) ============
// Vista mensual; arrastrar un creativo a otro día —o usar el selector de fecha
// del chip— reprograma su fecha de publicación (de publicación, no de generación).
// Abreviaturas de 2 letras para no repetir 'M' (martes/miércoles) ambiguas.
const WEEKDAYS: Array<{ short: string; long: string }> = [
  { short: 'Lu', long: 'lunes' },
  { short: 'Ma', long: 'martes' },
  { short: 'Mi', long: 'miércoles' },
  { short: 'Ju', long: 'jueves' },
  { short: 'Vi', long: 'viernes' },
  { short: 'Sá', long: 'sábado' },
  { short: 'Do', long: 'domingo' },
];

// Estado del creativo expuesto por texto + color (no solo color) en cada chip.
function chipStatusMeta(status: string): { label: string; chip: string; dot: string } {
  if (status === 'final_ready') {
    return { label: 'versión final lista', chip: 'border-brand/40 text-brand', dot: 'bg-brand' };
  }
  if (status === 'draft_ready') {
    return { label: 'borrador listo', chip: 'border-emerald-400/30 text-emerald-400/90', dot: 'bg-emerald-400' };
  }
  return { label: 'aún sin generar', chip: 'border-border text-muted-foreground', dot: 'bg-muted-foreground/60' };
}

export function CalendarView({
  items,
  onReschedule,
}: {
  items: StudioItem[];
  onReschedule: (itemId: string, date: string) => void;
}) {
  const firstDate = items.find((i) => i.scheduledDate)?.scheduledDate;
  const [monthStart, setMonthStart] = useState(() => {
    const base = firstDate ? new Date(`${firstDate}T12:00:00`) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [moveOpenId, setMoveOpenId] = useState<string | null>(null);

  const byDate = useMemo(() => {
    const map = new Map<string, StudioItem[]>();
    for (const item of items) {
      if (!item.scheduledDate) continue;
      const list = map.get(item.scheduledDate) ?? [];
      list.push(item);
      map.set(item.scheduledDate, list);
    }
    return map;
  }, [items]);

  // Celdas del mes con lunes como primer día de la semana.
  const cells = useMemo(() => {
    const year = monthStart.getFullYear();
    const month = monthStart.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const offset = (new Date(year, month, 1).getDay() + 6) % 7;
    const out: Array<{ iso: string; day: number } | null> = [];
    for (let i = 0; i < offset; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d, 12);
      out.push({ iso: date.toISOString().slice(0, 10), day: d });
    }
    return out;
  }, [monthStart]);

  // Semanas de 7 para que cada fila exponga role="row" (rejilla accesible) sin
  // alterar el layout: los wrappers usan display:contents.
  const weeks = useMemo(() => {
    const out: Array<Array<{ iso: string; day: number } | null>> = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [cells]);

  // Reprogramación compartida por arrastre y por el selector de fecha del chip.
  async function applyReschedule(itemId: string, dayIso: string) {
    const prev = items.find((i) => i.id === itemId)?.scheduledDate ?? null;
    if (prev === dayIso) return;
    onReschedule(itemId, dayIso); // optimista; revertimos si falla
    const res = await updateItemScheduleAction(itemId, dayIso);
    if (!res.ok) {
      if (prev) onReschedule(itemId, prev);
      toast.error('No se pudo reprogramar');
    }
  }

  async function handleDrop(dayIso: string) {
    if (!dragId) return;
    const itemId = dragId;
    setDragId(null);
    setOverDay(null);
    await applyReschedule(itemId, dayIso);
  }

  const monthLabel = monthStart.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });

  return (
    <div className="mt-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13.5px] font-medium capitalize text-foreground">{monthLabel}</p>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Mes anterior"
            onClick={() => setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1))}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Mes siguiente"
            onClick={() => setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1))}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div
        role="grid"
        aria-label={`Calendario de publicaciones, ${monthLabel}`}
        className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border/50"
      >
        <div role="row" className="contents">
          {WEEKDAYS.map((d) => (
            <div
              key={d.short}
              role="columnheader"
              aria-label={d.long}
              className="bg-muted/30 px-2 py-1.5 text-center text-[11px] uppercase text-muted-foreground"
            >
              {d.short}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div role="row" className="contents" key={`week-${wi}`}>
            {week.map((cell, ci) =>
              cell === null ? (
                <div key={`empty-${wi}-${ci}`} role="gridcell" aria-hidden className="min-h-20 bg-card/30" />
              ) : (
                <div
                  key={cell.iso}
                  role="gridcell"
                  aria-label={new Date(`${cell.iso}T12:00:00`).toLocaleDateString('es-MX', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverDay(cell.iso);
                  }}
                  onDragLeave={() => setOverDay((d) => (d === cell.iso ? null : d))}
                  onDrop={() => handleDrop(cell.iso)}
                  className={`min-h-20 bg-card/60 p-1.5 transition-colors ${overDay === cell.iso ? 'bg-primary/10' : ''}`}
                >
                  <p className="text-[11px] text-muted-foreground">{cell.day}</p>
                  <div className="mt-1 space-y-1">
                    {(byDate.get(cell.iso) ?? []).map((item) => {
                      const meta = chipStatusMeta(item.status);
                      return (
                        <Popover
                          key={item.id}
                          open={moveOpenId === item.id}
                          onOpenChange={(o) => setMoveOpenId(o ? item.id : null)}
                        >
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              draggable
                              onDragStart={() => setDragId(item.id)}
                              onDragEnd={() => setDragId(null)}
                              title={`${item.formatName} (${meta.label}): ${item.scenePrompt}`}
                              aria-label={`${item.formatName}, ${meta.label}. Reprogramar fecha de publicación`}
                              className={`flex w-full cursor-grab items-center gap-1 rounded-md border px-1.5 py-0.5 text-left text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing ${meta.chip}`}
                            >
                              <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${meta.dot}`} />
                              <span className="truncate">{item.formatName}</span>
                              <span className="sr-only"> ({meta.label})</span>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-56">
                            <label
                              htmlFor={`move-${item.id}`}
                              className="text-[11.5px] font-medium text-foreground"
                            >
                              Mover a fecha de publicación
                            </label>
                            <input
                              id={`move-${item.id}`}
                              type="date"
                              defaultValue={cell.iso}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (!v) return;
                                setMoveOpenId(null);
                                void applyReschedule(item.id, v);
                              }}
                              className="mt-1.5 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[12.5px] text-foreground outline-none [color-scheme:dark] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                            />
                          </PopoverContent>
                        </Popover>
                      );
                    })}
                  </div>
                </div>
              ),
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] text-muted-foreground">
        Arrastra un creativo a otro día —o ábrelo con Enter para elegir la fecha— para reprogramar su
        publicación. Verde: borrador listo; azul: versión final lista; gris: aún sin generar.
      </p>
    </div>
  );
}
