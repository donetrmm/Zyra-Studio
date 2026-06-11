'use client';

import Link from 'next/link';
import { ArrowRight, Clapperboard, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { deriveGate, type CampaignSummary } from '@/lib/campaigns/summary';
import { PipelineBar } from './PipelineBar';

export type { CampaignSummary };

export function CampaignsPage({ campaigns }: { campaigns: CampaignSummary[] }) {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">Campañas</h1>
          <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
            Del producto a los anuncios listos: el sistema arma el plan, tú apruebas en cada
            compuerta.
          </p>
        </div>
        <Link
          href="/app/campaigns/new"
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Sparkles className="size-4" aria-hidden />
          Nueva campaña
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <div className="grid size-16 place-items-center rounded-2xl border border-border bg-muted/30">
            <Clapperboard className="size-7 text-muted-foreground/60" aria-hidden />
          </div>
          <p className="text-[14px] text-foreground/80">Crea tu primera campaña</p>
          <p className="max-w-sm text-[12.5px] text-muted-foreground">
            Sube fotos de tu producto y el sistema propone el plan completo: formatos, escenas y
            calendario. Tú solo apruebas.
          </p>
          <Link
            href="/app/campaigns/new"
            className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Sparkles className="size-4" aria-hidden />
            Empezar
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {campaigns.map((c) => {
            const gate = deriveGate(c);
            return (
              <Link
                key={c.id}
                href={`/app/campaigns/${c.id}`}
                className="group block rounded-xl border border-border bg-card/50 p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-[14.5px] font-medium text-foreground">{c.name}</h3>
                    <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                      {c.productName}
                      {c.total > 0 && ` · ${c.total} creativos`}
                      {c.finals > 0 && ` · ${c.finals} finales`}
                      {c.failed > 0 && ` · ${c.failed} fallidos`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium',
                      gate.live ? 'text-muted-foreground' : 'text-primary',
                    )}
                  >
                    {gate.live && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                    {gate.cta}
                    {!gate.live && (
                      <ArrowRight
                        className="size-3.5 transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    )}
                  </span>
                </div>

                <div className="mt-3">
                  <PipelineBar gate={gate} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
