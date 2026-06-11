'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { buildImagePackAction, updateItemScheduleAction } from '@/server-actions/campaigns';
import { submitGenerationAction } from '@/server-actions/generations';
import type { StudioItem } from './CampaignStudioView';

// ============ Pack de imágenes (specs/v2/05 tarea 5) ============
// El server arma los prompts (FLUX + escenas ganadoras); el cliente genera
// una imagen por llamada con el flujo normal — cada una se cobra y cae en
// la librería de la campaña.
export function ImagePackCard({ campaignId }: { campaignId: string }) {
  const [count, setCount] = useState<4 | 6 | 8>(4);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function handlePack() {
    const plan = await buildImagePackAction(campaignId, count);
    if (!plan.ok) {
      toast.error(plan.message ?? 'No se pudo armar el pack');
      return;
    }
    const { specs, references } = plan.data;
    setProgress({ done: 0, total: specs.length });
    let ok = 0;
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
      if (res.ok) ok += 1;
      else if (res.error === 'insufficient_credits') {
        toast.error('Créditos insuficientes; pack detenido');
        break;
      }
      setProgress({ done: i + 1, total: specs.length });
    }
    setProgress(null);
    if (ok > 0) toast.success(`Pack listo: ${ok} imágenes en la librería de la campaña`);
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
            <p className="max-w-md text-[11.5px] text-muted-foreground/60">
              Posts 1:1 de las escenas ganadoras, banners 16:9 con espacio limpio para copy y stills de
              producto (FLUX; el copy va en el caption, no quemado en la imagen)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {([4, 6, 8] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCount(n)}
              disabled={progress !== null}
              className={`rounded-md border px-2.5 py-1 text-[12.5px] transition-colors ${
                count === n
                  ? 'border-primary/60 bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            disabled={progress !== null}
            onClick={handlePack}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground transition-opacity disabled:opacity-40"
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
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ Calendario (specs/v2/05 tarea 1) ============
// Vista mensual; arrastrar un creativo a otro día reprograma su fecha de
// publicación (la fecha es de publicación, no de generación).
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

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

  async function handleDrop(dayIso: string) {
    if (!dragId) return;
    const itemId = dragId;
    setDragId(null);
    setOverDay(null);
    const prev = items.find((i) => i.id === itemId)?.scheduledDate ?? null;
    if (prev === dayIso) return;
    onReschedule(itemId, dayIso); // optimista; revertimos si falla
    const res = await updateItemScheduleAction(itemId, dayIso);
    if (!res.ok) {
      if (prev) onReschedule(itemId, prev);
      toast.error('No se pudo reprogramar');
    }
  }

  const monthLabel = monthStart.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });

  return (
    <div className="mt-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13.5px] font-medium capitalize text-foreground">{monthLabel}</p>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Mes anterior"
            onClick={() => setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1))}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Mes siguiente"
            onClick={() => setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1))}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border/50">
        {WEEKDAYS.map((d, i) => (
          <div
            key={`${d}-${i}`}
            className="bg-muted/30 px-2 py-1.5 text-center text-[10.5px] uppercase text-muted-foreground/60"
          >
            {d}
          </div>
        ))}
        {cells.map((cell, idx) =>
          cell === null ? (
            <div key={`empty-${idx}`} className="min-h-20 bg-card/30" />
          ) : (
            <div
              key={cell.iso}
              onDragOver={(e) => {
                e.preventDefault();
                setOverDay(cell.iso);
              }}
              onDragLeave={() => setOverDay((d) => (d === cell.iso ? null : d))}
              onDrop={() => handleDrop(cell.iso)}
              className={`min-h-20 bg-card/60 p-1.5 transition-colors ${overDay === cell.iso ? 'bg-primary/10' : ''}`}
            >
              <p className="text-[10.5px] text-muted-foreground/50">{cell.day}</p>
              <div className="mt-1 space-y-1">
                {(byDate.get(cell.iso) ?? []).map((item) => (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={() => setDragId(item.id)}
                    onDragEnd={() => setDragId(null)}
                    title={`${item.formatName}: ${item.scenePrompt}`}
                    className={`cursor-grab truncate rounded-md border px-1.5 py-0.5 text-[10px] active:cursor-grabbing ${
                      item.status === 'final_ready'
                        ? 'border-violet-300/40 text-violet-300'
                        : item.status === 'draft_ready'
                          ? 'border-emerald-400/30 text-emerald-400/90'
                          : 'border-border text-muted-foreground'
                    }`}
                  >
                    {item.formatName}
                  </div>
                ))}
              </div>
            </div>
          ),
        )}
      </div>
      <p className="mt-2 text-[11.5px] text-muted-foreground/50">
        Arrastra un creativo a otro día para reprogramar su fecha de publicación. Verde: draft listo;
        violeta: final listo.
      </p>
    </div>
  );
}
