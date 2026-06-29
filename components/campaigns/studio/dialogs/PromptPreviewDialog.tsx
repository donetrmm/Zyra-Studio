'use client';

import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function PromptPreviewDialog({
  preview,
  onClose,
}: {
  preview: {
    loading: boolean;
    prompt: string | null;
    references: Array<{ kind: string; role: string; path: string }>;
    warnings: string[];
    errors: string[];
  };
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Prompt final (preview)</DialogTitle>
          <DialogDescription>
            Así se compila este creativo al generar: referencias con propósito, contexto,
            acción y dirección del formato. El texto del plan es solo la acción.
          </DialogDescription>
        </DialogHeader>
        {preview.loading ? (
          <div className="flex items-center gap-2 py-6 text-2sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Compilando…
          </div>
        ) : preview.errors.length > 0 ? (
          <div className="space-y-1 text-xs text-red-300/90">
            {preview.errors.map((e) => (
              <p key={e}>{e}</p>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-3 text-xs leading-relaxed text-foreground/90">
              {preview.prompt}
            </pre>
            {preview.references.length > 0 && (
              <div className="text-2xs text-muted-foreground">
                <p className="font-medium text-foreground/70">Referencias ({preview.references.length})</p>
                <ul className="mt-1 space-y-0.5">
                  {preview.references.map((r, i) => (
                    <li key={`${r.path}-${i}`}>
                      {r.kind === 'image' ? 'Imagen' : r.kind === 'video' ? 'Video' : 'Audio'} — {r.role}
                      <span className="ml-1 text-muted-foreground/50">{r.path.split('/').pop()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.warnings.length > 0 && (
              <div className="text-2xs text-amber-300/80">
                {preview.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
