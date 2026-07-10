'use client';

import Link from 'next/link';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { ZoomableImage } from '@/components/shared/ZoomableImage';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// Estado de "readiness" de un activo: responde de un vistazo "¿ya puedo usar
// esto?". `ready` es calmo (verde), `incomplete` llama la atención (ámbar,
// accionable), `error` alarma (rojo), `processing` es una espera (ámbar con
// pulso). Es la pieza central del feedback de las vistas de activos.
export type ReadinessStatus = 'ready' | 'incomplete' | 'processing' | 'error';

const READINESS_STYLES: Record<ReadinessStatus, { dot: string; label: string; pulse?: boolean }> = {
  ready: { dot: 'bg-emerald-500', label: 'text-muted-foreground' },
  incomplete: { dot: 'bg-amber-500', label: 'text-amber-400' },
  processing: { dot: 'bg-amber-500', label: 'text-muted-foreground', pulse: true },
  error: { dot: 'bg-destructive', label: 'text-destructive' },
};

export function ReadinessChip({
  status,
  label,
  className,
}: {
  status: ReadinessStatus;
  label: string;
  className?: string;
}) {
  const s = READINESS_STYLES[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-2xs font-medium', s.label, className)}>
      <span className={cn('size-1.5 shrink-0 rounded-full', s.dot, s.pulse && 'motion-safe:animate-pulse')} />
      {label}
    </span>
  );
}

export type CardAction =
  | { kind: 'link'; href: string; label: string; icon?: LucideIcon }
  | { kind: 'button'; onClick: () => void; label: string; icon?: LucideIcon };

export type CardMenuItem = {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

const ASPECT: Record<'portrait' | 'landscape' | 'square', string> = {
  portrait: 'aspect-[4/5]',
  landscape: 'aspect-[16/9]',
  square: 'aspect-square',
};

// Tarjeta de activo con la imagen como protagonista (image-hero), chip de
// readiness y barra de acciones consistente. La usan Cast, Locaciones y
// Productos; Kits/Voces/Referencias reusan solo ReadinessChip / AssetPageHeader
// porque su tarjeta tiene necesidades propias (swatches, player, selección).
export function AssetCard({
  media,
  title,
  description,
  readiness,
  meta,
  primary,
  secondary,
  menu,
}: {
  media: { url: string | null; alt: string; aspect: 'portrait' | 'landscape' | 'square'; fallbackIcon: LucideIcon };
  title: string;
  description?: string | null;
  readiness?: { status: ReadinessStatus; label: string };
  meta?: React.ReactNode;
  primary?: CardAction;
  secondary?: CardAction;
  menu?: CardMenuItem[];
}) {
  const FallbackIcon = media.fallbackIcon;
  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card/50 transition-colors hover:border-muted-foreground/25">
      <div className={cn('relative w-full overflow-hidden bg-muted/30', ASPECT[media.aspect])}>
        {media.url ? (
          <ZoomableImage src={media.url} alt={media.alt} className="size-full" />
        ) : (
          <div className="grid size-full place-items-center">
            <FallbackIcon className="size-8 text-muted-foreground/30" aria-hidden />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-3.5">
        <h3 className="truncate text-sm font-medium text-foreground">{title}</h3>
        {description ? (
          <p className="mt-0.5 line-clamp-1 text-2xs leading-relaxed text-muted-foreground/80">{description}</p>
        ) : null}
        {(readiness || meta) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {readiness && <ReadinessChip status={readiness.status} label={readiness.label} />}
            {meta}
          </div>
        )}
      </div>

      {(primary || secondary || (menu && menu.length > 0)) && (
        <div className="flex items-center gap-1.5 border-t border-border/40 p-2.5">
          {primary && <CardActionButton action={primary} accent />}
          {secondary && <CardActionButton action={secondary} />}
          {menu && menu.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto shrink-0 text-muted-foreground"
                  aria-label={`Más acciones para ${title}`}
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {menu.map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <DropdownMenuItem
                      key={item.label}
                      onClick={item.onClick}
                      disabled={item.disabled}
                      variant={item.destructive ? 'destructive' : 'default'}
                    >
                      {ItemIcon && <ItemIcon className="size-3.5" aria-hidden />}
                      {item.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  );
}

function CardActionButton({ action, accent }: { action: CardAction; accent?: boolean }) {
  const Icon = action.icon;
  const inner = (
    <>
      {Icon && <Icon className={cn('size-3.5', accent && 'text-brand')} aria-hidden />}
      {action.label}
    </>
  );
  const className = 'flex-1';
  if (action.kind === 'link') {
    return (
      <Button asChild variant="outline" size="sm" className={className}>
        <Link href={action.href}>{inner}</Link>
      </Button>
    );
  }
  return (
    <Button type="button" variant="outline" size="sm" className={className} onClick={action.onClick}>
      {inner}
    </Button>
  );
}
