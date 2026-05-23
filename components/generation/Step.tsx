'use client';

export function Step({
  index,
  title,
  subtitle,
  hint,
  children,
}: {
  index: number;
  title: string;
  subtitle?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-2.5 flex items-baseline gap-2">
        <span
          className="relative top-0.5 inline-grid size-[18px] shrink-0 place-items-center rounded-full text-[10.5px]"
          style={{
            background: 'rgba(123, 97, 255, 0.10)',
            border: '1px solid var(--zyra-accent-rim)',
            color: 'var(--zyra-accent-2)',
            fontFamily: 'var(--zyra-font-mono)',
          }}
        >
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="flex items-center justify-between gap-2"
            style={{ color: 'var(--zyra-text-1)' }}
          >
            <span className="text-[13px] font-medium">{title}</span>
            {hint}
          </div>
          {subtitle && (
            <div className="mt-px text-[11.5px]" style={{ color: 'var(--zyra-text-3)' }}>
              {subtitle}
            </div>
          )}
        </div>
      </header>
      <div>{children}</div>
    </section>
  );
}

export function SectionHeading({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <div
        className="text-[11px] font-medium uppercase tracking-[0.08em]"
        style={{ color: 'var(--zyra-text-3)' }}
      >
        {children}
      </div>
      {hint && (
        <div className="text-[11px]" style={{ color: 'var(--zyra-text-3)' }}>
          {hint}
        </div>
      )}
    </div>
  );
}
