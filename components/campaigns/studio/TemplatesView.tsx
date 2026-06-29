'use client';

import { useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { generateSeriesAction } from '@/server-actions/campaigns';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { StudioTemplate, StudioItem } from './types';

export function TemplatesView({
  templates,
  onSeriesCreated,
}: {
  templates: StudioTemplate[];
  onSeriesCreated: (created: StudioItem[]) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [count, setCount] = useState(3);
  const [rotateCharacters, setRotateCharacters] = useState(false);

  async function handleSeries(templateId: string) {
    setBusy(templateId);
    const res = await generateSeriesAction({ templateId, count, rotateCharacters });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo generar la serie');
      return;
    }
    // El canal realtime solo escucha UPDATE: agregar los items nuevos al estado
    // para que aparezcan sin recargar (evita el re-click que duplicaba la serie).
    onSeriesCreated(res.data.created);
    toast.success(`Serie creada: ${res.data.items} items en el plan — apruébalos desde Producción`);
  }

  if (templates.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-center gap-2 text-center text-muted-foreground/60">
        <p className="text-sm text-foreground/70">Sin plantillas todavía</p>
        <p className="max-w-md text-xs">
          Cuando un creativo final te funcione, conviértelo en plantilla desde Producción: su estructura,
          cámara y ritmo quedan fijos y puedes generar series rotando escena y personaje.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/50 p-3 text-xs">
        <span className="text-muted-foreground">Tamaño de la serie:</span>
        {[2, 3, 4, 6].map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={count === n}
            aria-label={`Tamaño de la serie: ${n}`}
            onClick={() => setCount(n)}
            className={`rounded-md border px-2.5 py-1 transition-colors ${
              count === n
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {n}
          </button>
        ))}
        <span className="ml-2 inline-flex items-center gap-2 text-muted-foreground">
          Rotar personajes del Cast
          <Switch
            checked={rotateCharacters}
            onCheckedChange={setRotateCharacters}
            size="sm"
            aria-label="Rotar personajes del Cast"
          />
        </span>
      </div>

      <div className="space-y-2">
        {templates.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/50 p-4">
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-medium text-foreground">{t.name}</p>
              <p className="text-2xs text-muted-foreground">
                {t.formatName} · usada {t.usesCount} {t.usesCount === 1 ? 'vez' : 'veces'}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={busy !== null}
              onClick={() => handleSeries(t.id)}
              className="shrink-0"
            >
              {busy === t.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
              Generar serie ({count})
            </Button>
          </div>
        ))}
      </div>
      <p className="text-2xs text-muted-foreground">
        La serie copia la estructura, cámara y ritmo del video ganador (entra como referencia @Video1) y
        rota la escena{rotateCharacters ? ' y el personaje' : ''}. Los items nuevos aparecen en el plan
        como planificados y se generan desde Producción con las compuertas normales.
      </p>
    </div>
  );
}
