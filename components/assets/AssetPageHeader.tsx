import { cn } from '@/lib/utils';

// Encabezado unificado de las vistas de activos: título + descripción a la
// izquierda, acciones a la derecha. Reemplaza las tres variantes de header que
// convivían en marca (raw button / Button shadcn / con badges).
export function AssetPageHeader({
  title,
  description,
  badge,
  notice,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  // Chip a la derecha del título (ej. "Experimental").
  badge?: React.ReactNode;
  // Aviso bajo la descripción (ej. "Gratis por tiempo limitado").
  notice?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="font-heading text-lg font-semibold text-foreground">{title}</h1>
          {badge}
        </div>
        {description ? (
          <p className="mt-1 max-w-xl text-2sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
        {notice}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
