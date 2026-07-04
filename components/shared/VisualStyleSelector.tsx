'use client';

import { Input } from '@/components/ui/input';
import type { VisualStyle } from '@/lib/prompt-director/style-profiles';

// Los hints son la guía de estilo del usuario: qué esperar de cada preset y
// cuándo usarlo (se muestran bajo el selector para la opción elegida).
export const VISUAL_STYLE_OPTIONS: Array<{ value: VisualStyle; label: string; hint: string }> = [
  {
    value: 'ultra_realista',
    label: 'Ultra realista',
    hint: 'Fotografía profesional: cámara full-frame, colores naturales sin tonos amarillos, física creíble. Para anuncios con look de producción.',
  },
  {
    value: 'casero',
    label: 'Casero',
    hint: 'Foto y video de celular: espontáneo, encuadre imperfecto, luz del lugar. Para contenido tipo UGC que no parece anuncio.',
  },
  {
    value: 'fantasia',
    label: 'Fantasía',
    hint: 'Mundos imaginarios con luz pictórica; la física puede romperse al servicio de la idea.',
  },
  {
    value: 'animado',
    label: 'Animado',
    hint: 'Película de animación 3D: formas limpias, color expresivo, física creíble.',
  },
  {
    value: 'custom',
    label: 'Personalizado',
    hint: 'Describe tu propio estilo (ej. acuarela suave, cómic de línea clara) y todas las etapas lo siguen.',
  },
];

// Selector de perfil de estilo visual (plan 2026-07-02). Mismo patron visual
// que el selector de formato de video del wizard. compact = grid 2x2 para las
// columnas angostas de los editores de activos.
export function VisualStyleSelector({
  value,
  customText,
  onValueChange,
  onCustomTextChange,
  compact = false,
}: {
  value: VisualStyle;
  customText: string;
  onValueChange: (v: VisualStyle) => void;
  onCustomTextChange: (t: string) => void;
  compact?: boolean;
}) {
  return (
    <div>
      <div className={compact ? 'grid grid-cols-2 gap-2' : 'flex gap-2'}>
        {VISUAL_STYLE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            title={o.hint}
            onClick={() => onValueChange(o.value)}
            className={`${compact ? '' : 'flex-1 '}rounded-lg border px-3 py-2 text-2sm transition-colors ${
              value === o.value
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {/* Guía del estilo elegido: siempre visible (el title solo aparece en hover). */}
      <p className="mt-1.5 text-2xs text-muted-foreground">
        {VISUAL_STYLE_OPTIONS.find((o) => o.value === value)?.hint}
      </p>
      {value === 'custom' && (
        <Input
          value={customText}
          onChange={(e) => onCustomTextChange(e.target.value)}
          placeholder="ej. acuarela suave, colores pastel, trazos visibles"
          maxLength={400}
          className="mt-2"
        />
      )}
    </div>
  );
}
