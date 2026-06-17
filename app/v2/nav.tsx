"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "./reveal";

const LINKS = [
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#formatos", label: "Formatos" },
  { href: "#oficio", label: "Capacidades" },
  { href: "#modelos", label: "Modelos" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={cn(
        "sticky top-0 z-50 border-b border-transparent backdrop-blur-xl transition-colors",
        scrolled && "border-white/8 bg-zinc-950/70"
      )}
    >
      <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-5 px-7 py-3.5">
        <Link href="/v2" className="flex items-center gap-2.5 font-medium text-zinc-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-8 w-auto" />
          1to1 Studio
        </Link>

        <div className="hidden items-center gap-1 rounded-full border border-white/8 bg-white/[0.02] p-1 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-full px-3.5 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-100"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:text-zinc-100 sm:inline-flex"
          >
            Iniciar sesión
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-[#009fff] px-4 py-2 text-sm font-semibold text-white transition-all hover:shadow-[0_0_24px_rgba(0,159,255,0.4)]"
          >
            Empezar gratis
          </Link>
        </div>
      </div>
    </nav>
  );
}
