'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// Empty state unificado para vistas de listado (Library, References, Presets,
// etc.). Mismo lenguaje visual que los empty states de los previews de
// generación: card cuadrada con icono primary suave, título, sub y CTA opcional.
export function PageEmptyState({
  icon: Icon,
  title,
  sub,
  cta,
  className,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  title: string;
  sub: string;
  cta?: { href: string; label: string; icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }> };
  className?: string;
}) {
  return (
    <div className={cn('grid h-full min-h-[360px] place-items-center p-6', className)}>
      <div className="max-w-[420px] text-center">
        <div className="mx-auto mb-4 grid size-16 place-items-center rounded-[18px] border border-border bg-muted/30 text-muted-foreground">
          <Icon className="size-5" aria-hidden />
        </div>
        <h3 className="font-heading text-[16px] font-medium text-foreground">{title}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{sub}</p>
        {cta && (
          <Link
            href={cta.href}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-primary/15"
          >
            {cta.icon ? <cta.icon className="size-3.5" aria-hidden /> : <ArrowRight className="size-3.5" aria-hidden />}
            {cta.label}
          </Link>
        )}
      </div>
    </div>
  );
}
