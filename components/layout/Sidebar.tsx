"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_SIDEBAR, type NavItem } from "@/lib/navigation";

export function Sidebar() {
  return (
    <aside className="hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground lg:flex">
      <Brand />
      <nav className="flex-1 overflow-y-auto px-3 pb-6">
        {APP_SIDEBAR.map((section, idx) => (
          <div key={idx} className="mt-6 first:mt-2">
            {section.title ? (
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <SidebarLink key={item.href} item={item} />
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function Brand() {
  return (
    <Link
      href="/app"
      className="flex h-16 items-center gap-2 border-b border-sidebar-border px-5 font-heading text-lg font-semibold tracking-tight"
    >
      <Sparkles className="size-5 text-primary" aria-hidden />
      Zyra Studio
    </Link>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const Icon = item.icon;
  const active =
    pathname === item.href ||
    (item.href !== "/app" && pathname.startsWith(item.href));

  return (
    <li>
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
}
