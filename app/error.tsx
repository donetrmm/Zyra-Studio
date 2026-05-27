'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error]', error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <div className="grid size-16 place-items-center rounded-2xl border border-destructive/30 bg-destructive/10">
        <AlertTriangle className="size-7 text-destructive" aria-hidden />
      </div>
      <h1 className="mt-6 text-[18px] font-semibold text-foreground">
        Algo salió mal
      </h1>
      <p className="mt-2 max-w-sm text-[13px] text-muted-foreground">
        Ocurrió un error inesperado. Intenta recargar la página o vuelve al inicio.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground/50">
          Ref: {error.digest}
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <Button onClick={reset} variant="outline">
          Reintentar
        </Button>
        <Button asChild>
          <Link href="/app">Ir al inicio</Link>
        </Button>
      </div>
    </main>
  );
}
