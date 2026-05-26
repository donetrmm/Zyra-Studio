"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Home,
  ImageIcon,
  Library,
  Menu,
  Mic,
  Video,
  Wallet,
  Files,
  Palette,
  Sparkles,
  FolderKanban,
  FlaskConical,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const MAIN_NAV = [
  { label: "Inicio", href: "/app", icon: Home },
  { label: "Crear", href: "/app/create/image", icon: ImageIcon },
  { label: "Library", href: "/app/library", icon: Library },
  { label: "Billing", href: "/app/billing", icon: Wallet },
] as const;

const MORE_NAV = [
  { label: "Video", href: "/app/create/video", icon: Video },
  { label: "Audio", href: "/app/create/audio", icon: Mic },
  { label: "Campañas", href: "/app/campaigns", icon: FolderKanban },
  { label: "Referencias", href: "/app/references", icon: Files },
  { label: "Brand Kits", href: "/app/brand-kits", icon: Palette },
  { label: "Voces", href: "/app/voices", icon: FlaskConical },
  { label: "Presets", href: "/app/presets", icon: Sparkles },
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
          className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {open && (
        <div className="fixed bottom-[52px] left-0 right-0 z-50 border-t border-border bg-card px-4 pb-2 pt-3 lg:hidden">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg px-2 py-2.5 text-[10.5px] transition-colors",
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

      <nav className="shrink-0 grid grid-cols-5 border-t border-border bg-background/95 lg:hidden">
        {MAIN_NAV.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href ||
            (item.href !== "/app" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-2 text-[11px] transition-colors",
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
          className={cn(
            "flex flex-col items-center justify-center gap-1 py-2 text-[11px] transition-colors",
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
