'use client';

import Link from 'next/link';
import { CalendarDays, Eye, Loader2, Pencil, Play, Sparkles, Trash2 } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import type { StudioItem } from './types';

export function PlanRow({
  item,
  campaignId,
  sceneNumber,
  editable,
  generating,
  generateTitle,
  onGenerate,
  onEdit,
  onPreview,
  onDelete,
}: {
  item: StudioItem;
  campaignId: string;
  sceneNumber?: number;
  editable: boolean;
  generating: boolean;
  generateTitle: string;
  onGenerate: (item: StudioItem) => void;
  onEdit: (item: StudioItem) => void;
  onPreview: (id: string) => void;
  onDelete: (item: StudioItem) => void;
}) {
  return (
    <tr className="border-b border-border/50 last:border-0">
      {sceneNumber !== undefined && (
        <td className="whitespace-nowrap px-3 py-2.5 text-2xs text-muted-foreground">{sceneNumber}</td>
      )}
      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="size-3 text-muted-foreground/40" aria-hidden />
          {item.scheduledDate
            ? new Date(`${item.scheduledDate}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
            : '—'}
        </span>
      </td>
      <td
        className="whitespace-nowrap px-3 py-2.5 text-foreground/90"
        title={item.formatDescription || undefined}
      >
        {item.formatName}
        {item.templateId && (
          <span className="ml-1.5 rounded-full border border-primary/40 px-1.5 py-0.5 text-2xs text-primary">
            serie
          </span>
        )}
        {item.characterNames.length > 0 && (
          <span className="ml-1.5 text-2xs text-muted-foreground">
            · {item.characterNames.join(' + ')}
          </span>
        )}
      </td>
      <td className="hidden max-w-md px-3 py-2.5 md:table-cell">
        {item.scene && (
          <p className="line-clamp-1 text-2xs text-muted-foreground">{item.scene}</p>
        )}
        <p className="line-clamp-2 text-muted-foreground/80">
          {item.sceneSummary ?? item.scenePrompt}
        </p>
        {item.caption && (
          <p className="mt-0.5 line-clamp-1 text-2xs text-muted-foreground">
            Caption: {item.caption}
          </p>
        )}
        {item.warnings.length > 0 && (
          <p className="mt-0.5 line-clamp-1 text-2xs text-amber-400/70">{item.warnings[0]}</p>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <StatusBadge status={item.status} />
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        <span className="inline-flex gap-1">
          {editable && (
            <>
              <button
                type="button"
                onClick={() => onGenerate(item)}
                disabled={generating}
                title={generateTitle}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-2xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              >
                {generating ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  <Play className="size-3" aria-hidden />
                )}
                Generar
              </button>
              <Link
                href={`/app/campaigns/${campaignId}/refine/${item.id}`}
                aria-label="Refinar con asistente"
                className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-primary"
              >
                <Sparkles className="size-3.5" aria-hidden />
              </Link>
              <button
                type="button"
                onClick={() => onEdit(item)}
                aria-label="Editar item"
                className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
              >
                <Pencil className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => onDelete(item)}
                aria-label="Eliminar item"
                className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-red-400"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => onPreview(item.id)}
            aria-label="Ver prompt final"
            className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
          >
            <Eye className="size-3.5" aria-hidden />
          </button>
        </span>
      </td>
    </tr>
  );
}
