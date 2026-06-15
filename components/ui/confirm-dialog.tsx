'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions>({ title: '' });
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    setOptions(opts);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  function handle(result: boolean) {
    setOpen(false);
    resolveRef.current?.(result);
    resolveRef.current = null;
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={open} onOpenChange={(o) => !o && handle(false)}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <div className="flex items-start gap-3">
            {options.destructive && (
              <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-destructive/30 bg-destructive/10">
                <AlertTriangle className="size-4 text-destructive" aria-hidden />
              </div>
            )}
            <div>
              <DialogTitle className="text-[15px] font-semibold text-foreground">
                {options.title}
              </DialogTitle>
              {options.description && (
                <DialogDescription className="mt-1.5 text-[13px] leading-relaxed">
                  {options.description}
                </DialogDescription>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => handle(false)}
              className="rounded-md border border-border px-4 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {options.cancelLabel ?? 'Cancelar'}
            </button>
            <button
              type="button"
              onClick={() => handle(true)}
              className={cn(
                'rounded-md px-4 py-2 text-[13px] font-medium transition-colors',
                options.destructive
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              {options.confirmLabel ?? 'Confirmar'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
