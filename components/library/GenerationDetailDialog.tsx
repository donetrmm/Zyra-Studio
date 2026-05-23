'use client';

import { useEffect, useState } from 'react';
import { Coins, Download, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type Detail = {
  id: string;
  prompt: string;
  model: string;
  variant: string;
  status: string;
  outputUrl: string | null;
  thumbnailUrl: string | null;
  credits: number;
  createdAt: number;
};

export function GenerationDetailDialog({
  id,
  onOpenChange,
}: {
  id: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetch(`/api/generations/${id}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setDetail(data);
      });
    return () => {
      cancelled = true;
      setDetail(null);
    };
  }, [id]);

  const loading = !!id && !detail;

  return (
    <Dialog open={!!id} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Generación</DialogTitle>
          <DialogDescription>Detalle y descarga.</DialogDescription>
        </DialogHeader>
        {loading || !detail ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-md bg-muted">
              {detail.outputUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={detail.outputUrl}
                  alt={detail.prompt}
                  className="max-h-[60vh] w-full object-contain"
                />
              ) : (
                <div className="flex h-64 items-center justify-center text-muted-foreground">
                  {detail.status}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">{detail.model}</Badge>
              <Badge variant="outline" className="gap-1">
                <Coins className="size-3" aria-hidden /> {detail.credits}
              </Badge>
              <Badge variant="outline">{detail.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{detail.prompt}</p>
            <div className="flex gap-2">
              {detail.outputUrl && (
                <Button asChild variant="outline" size="sm">
                  <a href={detail.outputUrl} download target="_blank" rel="noreferrer">
                    <Download className="size-4" aria-hidden /> Descargar
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
