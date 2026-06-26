import { cn } from '@/lib/utils';
import { PIPELINE_STAGES, type CampaignGate } from '@/lib/campaigns/summary';

// Barra de pipeline Plan → Muestra → Lote → Entrega. Presentacional pura:
// la usan la lista de campañas (client) y el dashboard (server).
export function PipelineBar({ gate }: { gate: CampaignGate }) {
  const stageCount = PIPELINE_STAGES.length;
  const currentLabel = PIPELINE_STAGES[gate.stage] ?? PIPELINE_STAGES[0];
  return (
    <div
      role="progressbar"
      aria-label="Progreso de la campaña"
      aria-valuemin={0}
      aria-valuemax={stageCount}
      aria-valuenow={gate.stage + 1}
      aria-valuetext={`Etapa ${gate.stage + 1} de ${stageCount}: ${currentLabel}${
        gate.live ? ' (generando)' : ''
      }`}
      className="flex items-center gap-1.5"
    >
      {PIPELINE_STAGES.map((label, i) => (
        <div key={label} className="flex-1">
          <div
            className={cn(
              'h-1 rounded-full',
              i < gate.stage
                ? 'bg-primary/70'
                : i === gate.stage
                  ? gate.live
                    ? 'bg-primary motion-safe:animate-pulse'
                    : 'bg-primary'
                  : 'bg-muted',
            )}
          />
          {/* Peso de texto como señal no-cromatica del estado (WCAG 1.4.1):
              completada (medium) / actual (semibold) / pendiente (normal). */}
          <p
            className={cn(
              'mt-1 text-[11px] uppercase tracking-wide',
              i < gate.stage
                ? 'font-medium text-muted-foreground'
                : i === gate.stage
                  ? 'font-semibold text-foreground/80'
                  : 'text-muted-foreground',
            )}
          >
            {label}
          </p>
        </div>
      ))}
    </div>
  );
}
