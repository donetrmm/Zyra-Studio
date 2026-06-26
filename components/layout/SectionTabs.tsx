'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export type SectionTab = { label: string; href: string };

// Tabs de navegación interna de un segmento (Marca, Creación rápida).
// Mismo lenguaje visual que los tabs del Campaign Studio.
export function SectionTabs({ tabs }: { tabs: SectionTab[] }) {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-0.5 sm:inline-flex">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-md px-3 py-1.5 text-[12.5px] transition-colors',
              active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
