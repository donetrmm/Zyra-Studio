'use client';

import { useState, useTransition } from 'react';
import { Ruler } from 'lucide-react';
import { setProductDimensionsAction } from '@/server-actions/campaigns';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function ProductSizeEditor({
  campaignId,
  initialHeightCm,
  initialWidthCm,
  initialMedium,
  initialThicknessMm,
}: {
  campaignId: string;
  initialHeightCm?: number;
  initialWidthCm?: number;
  initialMedium?: string;
  initialThicknessMm?: number;
}) {
  const [medium, setMedium] = useState(initialMedium ?? '');
  const [thickness, setThickness] = useState(initialThicknessMm?.toString() ?? '');
  const [height, setHeight] = useState(initialHeightCm?.toString() ?? '');
  const [width, setWidth] = useState(initialWidthCm?.toString() ?? '');
  const [pending, startTransition] = useTransition();

  const parse = (v: string): number | null => {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const save = () => {
    const h = parse(height);
    const w = parse(width);
    const t = parse(thickness);
    if (height.trim() && h === null) { toast.error('Alto inválido'); return; }
    if (width.trim() && w === null) { toast.error('Ancho inválido'); return; }
    if (thickness.trim() && t === null) { toast.error('Grosor inválido'); return; }
    startTransition(async () => {
      const res = await setProductDimensionsAction({
        id: campaignId,
        heightCm: h,
        widthCm: w,
        medium: medium.trim() || null,
        thicknessMm: t,
      });
      if (res.ok) toast.success('Producto físico guardado');
      else toast.error('No se pudo guardar');
    });
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center gap-2">
        <Ruler className="h-4 w-4 text-[#009fff]" aria-hidden />
        <h3 className="text-sm font-medium text-zinc-100">Producto físico</h3>
        <span className="text-xs text-zinc-500">opcional</span>
      </div>
      <p className="mt-1 max-w-prose text-xs leading-relaxed text-zinc-400">
        Tipo de soporte, grosor y tamaño real del producto (por ejemplo, un canvas de 150 cm de
        alto × 10 mm de grosor). Se usan para mantener proporción y contexto al generar y
        regenerar los paneles del storyboard. Deja vacío lo que no aplique.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Tipo de producto / soporte
          <Input
            type="text"
            value={medium}
            onChange={(e) => setMedium(e.target.value)}
            className="w-52"
            placeholder="ej. canvas, taza, playera"
            maxLength={120}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Grosor (mm)
          <Input
            type="number"
            inputMode="numeric"
            value={thickness}
            onChange={(e) => setThickness(e.target.value)}
            className="w-24"
            placeholder="ej. 10"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Alto (cm)
          <Input
            type="number"
            inputMode="numeric"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            className="w-24"
            placeholder="ej. 150"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Ancho (cm)
          <Input
            type="number"
            inputMode="numeric"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            className="w-24"
            placeholder="ej. 100"
          />
        </label>
        <Button type="button" variant="secondary" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </div>
  );
}
