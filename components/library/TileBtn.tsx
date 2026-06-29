'use client';

import { Loader2 } from 'lucide-react';

export function TileBtn({
  children,
  onClick,
  title,
  busy,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={busy}
      className="grid size-6 place-items-center rounded-md border border-border/40 bg-background/70 text-foreground backdrop-blur transition-colors hover:bg-background/90 disabled:cursor-not-allowed"
    >
      {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : children}
    </button>
  );
}
