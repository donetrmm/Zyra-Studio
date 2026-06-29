'use client';

import { cn } from '@/lib/utils';
import { modelLabel } from '@/lib/library/format';
import type { LibraryGeneration } from '@/lib/library/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function CompareModal({
  generations,
  onClose,
}: {
  generations: LibraryGeneration[];
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="scroll-thin max-h-[90vh] overflow-y-auto p-6 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Comparador A/B</DialogTitle>
        </DialogHeader>
        <div className={cn('grid gap-4', generations.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : generations.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4')}>
          {generations.map((g) => (
            <div key={g.id} className="space-y-2">
              <div className="overflow-hidden rounded-lg border border-border bg-black">
                {g.thumbnailUrl ? (
                  g.type === 'video' ? (
                    <video src={g.thumbnailUrl} controls muted playsInline className="w-full" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={g.thumbnailUrl} alt={g.prompt} className="w-full object-contain" />
                  )
                ) : (
                  <div className="grid h-40 place-items-center text-muted-foreground/50">Sin preview</div>
                )}
              </div>
              <p className="line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">{g.prompt}</p>
              <p className="text-[11px] text-muted-foreground/50">{modelLabel(g)}</p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
