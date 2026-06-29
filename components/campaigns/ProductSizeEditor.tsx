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
}: {
  campaignId: string;
  initialHeightCm?: number;
  initialWidthCm?: number;
}) {
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
    if (height.trim() && h === null) { toast.error('Alto inválido'); return; }
    if (width.trim() && w === null) { toast.error('Ancho inválido'); return; }
    startTransition(async () => {
      const res = await setProductDimensionsAction({ id: campaignId, heightCm: h, widthCm: w });
      if (res.ok) toast.success('Tamaño guardado');
      else toast.error('No se pudo guardar el tamaño');
    });
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center gap-2">
        <Ruler className="h-4 w-4 text-[#009fff]" aria-hidden />
        <h3 className="text-sm font-medium text-zinc-100">Tamaño físico del producto</h3>
        <span className="text-xs text-zinc-500">opcional</span>
      </div>
      <p className="mt-1 max-w-prose text-xs leading-relaxed text-zinc-400">
        El tamaño real del producto (por ejemplo, un cuadro de 150 cm de alto). Se usa para
        mantener su proporción frente al personaje al generar y regenerar los paneles del
        storyboard. Déjalo vacío si el producto no tiene un tamaño relevante.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
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
          {pending ? 'Guardando…' : 'Guardar tamaño'}
        </Button>
      </div>
    </div>
  );
}
