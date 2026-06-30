'use client';
import { useState, useTransition } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { setCreativeGuidelinesAction } from '@/server-actions/campaigns';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function CreativeGuidelinesEditor({
  campaignId,
  aspectRatio,
  initial,
}: {
  campaignId: string;
  aspectRatio?: string | null;
  initial?: { showFullProduct?: boolean; hookProductHero?: boolean; safeCrop?: '4:5' | null; safeAreaExtend?: boolean };
}) {
  const [showFullProduct, setShowFullProduct] = useState(initial?.showFullProduct ?? false);
  const [hookProductHero, setHookProductHero] = useState(initial?.hookProductHero ?? false);
  const [safeCrop, setSafeCrop] = useState<'4:5' | null>(initial?.safeCrop ?? null);
  const [safeAreaExtend, setSafeAreaExtend] = useState(initial?.safeAreaExtend ?? false);
  const [pending, startTransition] = useTransition();

  const canExtend = aspectRatio === '9:16' && safeCrop === '4:5';

  const save = () => {
    startTransition(async () => {
      const res = await setCreativeGuidelinesAction({
        id: campaignId,
        showFullProduct,
        hookProductHero,
        safeCrop,
        safeAreaExtend: canExtend ? safeAreaExtend : false,
      });
      if (res.ok) toast.success('Guías guardadas');
      else toast.error('No se pudieron guardar las guías');
    });
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-[#009fff]" aria-hidden />
        <h3 className="text-sm font-medium text-zinc-100">Guías creativas</h3>
        <span className="text-xs text-zinc-500">opcional</span>
      </div>
      <p className="mt-1 max-w-prose text-xs leading-relaxed text-zinc-400">
        Reglas de encuadre que aplican solo a esta campaña al generar y regenerar paneles y video.
        Apagadas, no cambian nada.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <Switch checked={showFullProduct} onCheckedChange={setShowFullProduct} />
          Mostrar el producto completo
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <Switch checked={hookProductHero} onCheckedChange={setHookProductHero} />
          Hook con el producto al 100%
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <Switch checked={safeCrop === '4:5'} onCheckedChange={(c) => setSafeCrop(c ? '4:5' : null)} />
          Encuadre recortable a 4:5
        </label>
        {canExtend && (
          <label className="flex flex-col gap-1 text-xs text-zinc-300">
            <span className="flex items-center gap-2">
              <Switch checked={safeAreaExtend} onCheckedChange={setSafeAreaExtend} />
              Zona segura 4:5 (extiende el 4:5 a 9:16 con outpaint)
            </span>
            <span className="pl-10 text-[11px] leading-relaxed text-zinc-400">
              Genera la base en 4:5 (producto completo y a escala) y la expande a 9:16 con outpaint real: el 9:16 queda nitido y el recorte a 4:5 es exacto. Cuesta ~2x (base + expansion).
            </span>
          </label>
        )}
      </div>
      <div className="mt-3">
        <Button type="button" variant="secondary" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar guías'}
        </Button>
      </div>
    </div>
  );
}
