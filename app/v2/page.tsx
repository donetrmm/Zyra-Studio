import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "./nav";
import { Hero } from "./hero";
import { Sections } from "./sections";

export const metadata: Metadata = {
  title: "1to1 Studio · Campaign Studio",
  description:
    "De un brief a una campaña completa. Produce campañas publicitarias con calidad de director creativo senior — en lote, con menos iteraciones y costo visible.",
};

function Footer() {
  return (
    <footer className="border-t border-white/8 py-14">
      <div className="mx-auto max-w-[1180px] px-7">
        <div className="grid gap-10 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="max-w-xs">
            <Link href="/v2" className="flex items-center gap-2.5 font-medium text-zinc-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="" className="h-8 w-auto" />
              1to1 Studio
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-zinc-500">
              Un sistema operativo para producir campañas publicitarias con IA.
              Calidad senior, en lote, con menos iteraciones.
            </p>
          </div>
          <div>
            <h5 className="text-sm font-medium text-zinc-300">Producto</h5>
            <ul className="mt-3 space-y-2 text-sm text-zinc-500">
              <li><a href="#como-funciona" className="transition-colors hover:text-zinc-200">Cómo funciona</a></li>
              <li><a href="#formatos" className="transition-colors hover:text-zinc-200">Formatos</a></li>
              <li><a href="#oficio" className="transition-colors hover:text-zinc-200">Capacidades</a></li>
              <li><a href="#modelos" className="transition-colors hover:text-zinc-200">Modelos</a></li>
            </ul>
          </div>
          <div>
            <h5 className="text-sm font-medium text-zinc-300">Cuenta</h5>
            <ul className="mt-3 space-y-2 text-sm text-zinc-500">
              <li><Link href="/signup" className="transition-colors hover:text-zinc-200">Crear cuenta</Link></li>
              <li><Link href="/login" className="transition-colors hover:text-zinc-200">Iniciar sesión</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-white/8 pt-6 text-sm text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
          <span>2026 1to1 Studio</span>
        </div>
      </div>
    </footer>
  );
}

export default function LandingV2() {
  return (
    <main className="min-h-screen bg-[#09090b] text-zinc-100 [font-family:var(--font-heading)] antialiased">
      <Nav />
      <Hero />
      <Sections />
      <Footer />
    </main>
  );
}
