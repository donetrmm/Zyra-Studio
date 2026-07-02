'use client';

import { Input } from '@/components/ui/input';
import type { VisualStyle } from '@/lib/prompt-director/style-profiles';

export const VISUAL_STYLE_OPTIONS: Array<{ value: VisualStyle; label: string; hint: string }> = [
  { value: 'ultra_realista', label: 'Ultra realista', hint: 'Fotografía real, física creíble' },
  { value: 'fantasia', label: 'Fantasía', hint: 'Mundos imaginarios, física libre' },
  { value: 'animado', label: 'Animado', hint: 'Look de animación 3D' },
  { value: 'custom', label: 'Personalizado', hint: 'Describe tu propio estilo' },
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
