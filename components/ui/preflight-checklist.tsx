'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Check, ListChecks } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';

// Checklist informativo de pre-vuelo: recordatorios de restricciones y buenas
// prácticas antes de una acción cara (armar campaña, generar). Patrón de
// proveedor como useConfirm: una sola instancia de diálogo, API por promesa.
//   const preflight = usePreflight();
//   if (!(await preflight(CAMPAIGN_CHECKLIST))) return; // canceló
// Con `dontShowAgainKey`, ofrece "no volver a mostrar" (recordado por
// dispositivo en localStorage) y se salta si ya fue descartado.

export type ChecklistItem = { text: string; sub?: string };

export type PreflightOptions = {
  title: string;
  intro?: string;
  items: ChecklistItem[];
  confirmLabel?: string;
  cancelLabel?: string;
  dontShowAgainKey?: string;
};

type PreflightFn = (opts: PreflightOptions) => Promise<boolean>;

const PreflightContext = createContext<PreflightFn>(() => Promise.resolve(true));

export function usePreflight(): PreflightFn {
  return useContext(PreflightContext);
}

function isDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function PreflightProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PreflightOptions>({ title: '', items: [] });
  const [dontShow, setDontShow] = useState(false);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const preflight = useCallback((opts: PreflightOptions): Promise<boolean> => {
    // Ya descartado en este dispositivo: continuar sin estorbar.
    if (opts.dontShowAgainKey && isDismissed(opts.dontShowAgainKey)) {
      return Promise.resolve(true);
    }
    setOptions(opts);
    setDontShow(false);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  function settle(result: boolean) {
    if (result && options.dontShowAgainKey && dontShow) {
      try {
        localStorage.setItem(options.dontShowAgainKey, '1');
      } catch {
        // localStorage no disponible: no es crítico, solo no se recuerda.
      }
    }
    setOpen(false);
    resolveRef.current?.(result);
    resolveRef.current = null;
  }

  return (
    <PreflightContext.Provider value={preflight}>
      {children}
      <Dialog open={open} onOpenChange={(o) => !o && settle(false)}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="size-4 text-primary" aria-hidden />
              {options.title}
            </DialogTitle>
            {options.intro && <DialogDescription>{options.intro}</DialogDescription>}
          </DialogHeader>
          <ul className="space-y-2.5">
            {options.items.map((it, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[12.5px]">
                <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                <span className="text-foreground/90">
                  {it.text}
                  {it.sub && (
                    <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{it.sub}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {options.dontShowAgainKey && (
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Switch
                checked={dontShow}
                onCheckedChange={setDontShow}
                size="sm"
                aria-label="No volver a mostrar"
              />
              No volver a mostrar
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => settle(false)}
              className="rounded-md border border-border px-4 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {options.cancelLabel ?? 'Volver y ajustar'}
            </button>
            <button
              type="button"
              onClick={() => settle(true)}
              className="rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {options.confirmLabel ?? 'Continuar'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </PreflightContext.Provider>
  );
}
