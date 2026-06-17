'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// Modal de bienvenida: se muestra UNA vez (recordado por dispositivo) tras
// entrar al app. Resume el flujo principal y enlaza a la Guía completa. No es
// un tour: es un punto de partida que el usuario puede saltar.

const KEY = 'welcome:seen';
const EVENT = 'welcome:change';

// Estado "ya visto" en localStorage, leído con useSyncExternalStore: el snapshot
// de servidor devuelve `true` (no mostrar en SSR) y el cliente lee el valor real
// tras hidratar, sin mismatch ni setState en efecto. Un evento del window notifica
// los cambios (descartar o reabrir) para que el modal reaccione sin recargar.
function subscribe(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
function getSnapshot(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true;
  }
}
const getServerSnapshot = (): boolean => true;

// Reabre la bienvenida (desde el menú de usuario): borra el flag y notifica.
export function resetWelcome() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // sin persistencia: no es crítico.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

const STEPS = [
  {
    title: 'Crea una campaña',
    sub: 'Sube tu producto y la IA arma un plan de anuncios con esos creativos.',
  },
  {
    title: 'Produce de borrador a final',
    sub: 'Revisa la muestra, lanza el lote y aprueba la versión final en alta.',
  },
  {
    title: 'Creación rápida',
    sub: 'Genera imágenes, videos o voces sueltos cuando no necesites una campaña.',
  },
  {
    title: 'Todo en tu Biblioteca',
    sub: 'Lo que generes se guarda y se agrupa por campaña o colección.',
  },
];

export function WelcomeModal() {
  const seen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const open = !seen;

  function dismiss() {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // sin persistencia: el modal podría reaparecer, no es crítico.
    }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Te damos la bienvenida a 1to1 Studio</DialogTitle>
          <DialogDescription>Del producto a los anuncios listos, con IA.</DialogDescription>
        </DialogHeader>
        <ol className="space-y-3">
          {STEPS.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 font-mono text-[12px] font-medium text-primary">
                {i + 1}
              </span>
              <div>
                <p className="text-[13px] font-medium text-foreground">{s.title}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{s.sub}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg border border-border px-4 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Explorar por mi cuenta
          </button>
          <Link
            href="/app/guide"
            onClick={dismiss}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Sparkles className="size-3.5" aria-hidden />
            Ver la guía completa
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
