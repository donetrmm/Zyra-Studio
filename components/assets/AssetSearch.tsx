'use client';

import { Search, X } from 'lucide-react';

// Barra de búsqueda cliente para filtrar activos por nombre/descripción.
// Se muestra solo cuando hay algo que filtrar (el caller decide el umbral).
export function AssetSearch({
  value,
  onChange,
  placeholder = 'Buscar…',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50"
          aria-hidden
        />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-8 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Limpiar búsqueda"
            className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
