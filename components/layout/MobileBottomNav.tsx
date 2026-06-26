"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Clapperboard,
  Home,
  Library,
  Menu,
  Wallet,
  Palette,
  Sparkles,
  FolderKanban,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const MAIN_NAV = [
  { label: "Inicio", href: "/app", icon: Home },
  { label: "Campañas", href: "/app/campaigns", icon: FolderKanban },
  { label: "Crear", href: "/app/create", icon: Sparkles },
  { label: "Biblioteca", href: "/app/library", icon: Library },
] as const;

const MORE_NAV = [
  { label: "Marca", href: "/app/brand", icon: Palette },
  { label: "Formatos", href: "/app/formats", icon: Clapperboard },
  { label: "Créditos", href: "/app/billing", icon: Wallet },
] as const;

export function MobileBottomNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isMoreActive = MORE_NAV.some(
    (item) => pathname === item.href || pathname.startsWith(item.href),
  );

  return (
    <>
      {open && (
        <div
          aria-hidden
          className="fixed inset-0 bottom-[52px] z-40 bg-background/60 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <nav aria-label="Navegación principal" className="relative z-50 shrink-0 grid grid-cols-5 border-t border-border bg-background/95 lg:hidden">
        {open && (
          <div id="more-panel" className="absolute bottom-full left-0 right-0 border-t border-border bg-card px-4 pb-2 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                Más secciones
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {MORE_NAV.map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href || pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg px-2 py-2.5 text-2xs transition-colors",
                      active
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
        {MAIN_NAV.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href ||
            (item.href !== "/app" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-2 text-2xs transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-5" aria-hidden />
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="more-panel"
          className={cn(
            "flex flex-col items-center justify-center gap-1 py-2 text-2xs transition-colors",
            open || isMoreActive
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Menu className="size-5" aria-hidden />
          Más
        </button>
      </nav>
    </>
  );
}
