"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { APP_SIDEBAR, type NavItem } from "@/lib/navigation";

export function Sidebar() {
  return (
    <aside className="hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground lg:flex">
      <Brand />
      <nav className="scroll-thin flex-1 overflow-y-auto px-3 pb-6">
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="" className="size-6" />
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
          "flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden />
        <span className="flex-1">{item.label}</span>
        {item.badge && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
            {item.badge}
          </span>
        )}
      </Link>
    </li>
  );
}
