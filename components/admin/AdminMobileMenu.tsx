'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ADMIN_SIDEBAR } from '@/lib/navigation';

export function AdminMobileMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="grid size-9 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground lg:hidden"
      >
        <Menu className="size-4" aria-hidden />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm lg:hidden"
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-[60] w-64 border-r border-border bg-[#09090b] lg:hidden">
            <div className="flex h-16 items-center justify-between border-b border-border px-5">
              <div className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="" className="h-7 w-auto" />
                <span>1to1</span>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-[14px] font-normal text-muted-foreground">Admin</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <nav className="px-3 py-4">
              {ADMIN_SIDEBAR.map((section, idx) => (
                <ul key={idx} className="space-y-0.5">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active =
                      pathname === item.href ||
                      (item.href !== '/admin' && pathname.startsWith(item.href));
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className={cn(
                            'flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors',
                            active
                              ? 'bg-primary/10 text-foreground'
                              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                          )}
                        >
                          <Icon className="size-4" aria-hidden />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ))}
            </nav>
            <div className="border-t border-border px-3 py-3">
              <Link
                href="/app"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                ← Volver al app
              </Link>
            </div>
          </div>
        </>
      )}
    </>
  );
}
