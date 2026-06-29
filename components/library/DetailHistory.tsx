'use client';
import { batchLabel } from '@/lib/library/format';
import type { LibraryGeneration } from '@/lib/library/types';

export function DetailHistory({ generation, allGenerations, onNavigate }: {
  generation: LibraryGeneration; allGenerations: LibraryGeneration[]; onNavigate: (id: string) => void;
}) {
  const parent = generation.parentGenerationId
    ? allGenerations.find((g) => g.id === generation.parentGenerationId)
    : null;
  const children = allGenerations.filter((g) => g.parentGenerationId === generation.id);
  const siblings = generation.batchId
    ? allGenerations.filter((g) => g.batchId === generation.batchId && g.id !== generation.id)
    : [];
  if (!parent && children.length === 0 && siblings.length === 0) return null;
  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Historial
      </p>
      {parent && (
        <button
          type="button"
          onClick={() => onNavigate(parent.id)}
          className="mb-1.5 flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="text-[11px]">↑</span>
          <span className="min-w-0 flex-1 truncate">{parent.prompt || 'Padre'}</span>
        </button>
      )}
      {siblings.length > 0 && (
        <div className="mb-1.5">
          <p className="mb-1 text-[11px] text-muted-foreground/60">
            Batch ({generation.batchKind ? batchLabel(generation.batchKind) : ''}) · {siblings.length + 1} items
          </p>
          {siblings.slice(0, 5).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onNavigate(s.id)}
              className="mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-left text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              <span className="text-[11px]">↔</span>
              <span className="min-w-0 flex-1 truncate">{s.prompt || s.id.slice(0, 8)}</span>
            </button>
          ))}
        </div>
      )}
      {children.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] text-muted-foreground/60">
            Derivadas · {children.length}
          </p>
          {children.slice(0, 5).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onNavigate(c.id)}
              className="mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-left text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              <span className="text-[11px]">↓</span>
              <span className="min-w-0 flex-1 truncate">{c.prompt || c.id.slice(0, 8)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
