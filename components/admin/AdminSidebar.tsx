"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { ADMIN_SIDEBAR } from "@/lib/navigation";

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground lg:flex">
      <Link
        href="/admin"
        className="flex h-16 items-center gap-2 border-b border-sidebar-border px-5 font-heading text-lg font-semibold tracking-tight"
      >
        <ShieldCheck className="size-5 text-primary" aria-hidden />
        Admin
      </Link>
      <nav className="scroll-thin flex-1 overflow-y-auto px-3 py-4">
        {ADMIN_SIDEBAR.map((section, idx) => (
          <ul key={idx} className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.href ||
                (item.href !== "/admin" && pathname.startsWith(item.href));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
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
      <div className="border-t border-sidebar-border px-3 py-3">
        <Link
          href="/app"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
        >
          ← Volver al app
        </Link>
      </div>
    </aside>
  );
}
