'use client';

import { useRef, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

export type SectionTab = { label: string; href: string; count?: number };

// Tabs de navegación interna de un segmento (Marca, Creación rápida).
// Mismo lenguaje visual que los tabs del Campaign Studio.
export function SectionTabs({ tabs }: { tabs: SectionTab[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const tabRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  function handleKeyDown(e: KeyboardEvent<HTMLAnchorElement>, idx: number) {
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next !== null) {
      e.preventDefault();
      router.push(tabs[next].href);
      tabRefs.current[next]?.focus();
    }
  }

  return (
    <nav
      role="tablist"
      aria-label="Secciones"
      className="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-0.5 sm:inline-flex"
    >
      {tabs.map((tab, idx) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            ref={(el) => { tabRefs.current[idx] = el; }}
            href={tab.href}
            role="tab"
            aria-selected={active}
            aria-current={active ? 'page' : undefined}
            tabIndex={active ? 0 : -1}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={cn(
              'whitespace-nowrap rounded-md px-3 py-1.5 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            {tab.count ? (
              <span
                className={cn(
                  'ml-1.5 tabular-nums',
                  active ? 'text-muted-foreground' : 'text-muted-foreground/60',
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
