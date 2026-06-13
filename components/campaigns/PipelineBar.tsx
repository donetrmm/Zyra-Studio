import { cn } from '@/lib/utils';
import { PIPELINE_STAGES, type CampaignGate } from '@/lib/campaigns/summary';

// Barra de pipeline Plan → Muestra → Lote → Entrega. Presentacional pura:
// la usan la lista de campañas (client) y el dashboard (server).
export function PipelineBar({ gate }: { gate: CampaignGate }) {
  return (
    <div className="flex items-center gap-1.5">
      {PIPELINE_STAGES.map((label, i) => (
        <div key={label} className="flex-1">
          <div
            className={cn(
              'h-1 rounded-full',
              i < gate.stage
                ? 'bg-primary/70'
                : i === gate.stage
                  ? gate.live
                    ? 'animate-pulse bg-primary'
                    : 'bg-primary'
                  : 'bg-muted',
            )}
          />
          <p
            className={cn(
              'mt-1 text-[11px] uppercase tracking-wide',
              i === gate.stage ? 'text-foreground/80' : 'text-muted-foreground/50',
            )}
          >
            {label}
          </p>
        </div>
      ))}
    </div>
  );
}
