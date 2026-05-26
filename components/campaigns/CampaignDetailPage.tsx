'use client';

import Link from 'next/link';
import { ArrowLeft, ImageIcon, Mic, Video } from 'lucide-react';

type Generation = {
  id: string;
  type: string;
  prompt: string;
  status: string;
  thumbnailUrl: string | null;
  credits: number;
  createdAt: string;
};

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
};

const TYPE_ICON = { image: ImageIcon, video: Video, audio: Mic } as const;

export function CampaignDetailPage({
  campaign,
  generations,
}: {
  campaign: Campaign;
  generations: Generation[];
}) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 lg:px-8">
      <Link
        href="/app/campaigns"
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Campañas
      </Link>

      <div className="flex items-start gap-3">
        <div className="mt-1 size-3 shrink-0 rounded-full" style={{ backgroundColor: campaign.color }} />
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">{campaign.name}</h1>
          {campaign.description && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">{campaign.description}</p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground/50">
            {generations.length} generacion{generations.length !== 1 ? 'es' : ''} · creada {new Date(campaign.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
      </div>

      {generations.length === 0 ? (
        <div className="mt-12 text-center text-muted-foreground/60">
          <p className="text-[14px] text-foreground/70">Sin generaciones asignadas</p>
          <p className="mt-1 text-[12.5px]">Asigna generaciones a esta campaña desde la biblioteca o al crear contenido</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {generations.map((g) => {
            const Icon = TYPE_ICON[g.type as keyof typeof TYPE_ICON] ?? ImageIcon;
            return (
              <Link
                key={g.id}
                href="/app/library"
                className="group overflow-hidden rounded-xl border border-border bg-card/50 transition-colors hover:border-muted-foreground/20"
              >
                {g.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.thumbnailUrl} alt={g.prompt} className="aspect-square w-full object-cover" />
                ) : (
                  <div className="grid aspect-square place-items-center bg-muted/20">
                    <Icon className="size-8 text-muted-foreground/30" aria-hidden />
                  </div>
                )}
                <div className="p-2.5">
                  <p className="line-clamp-2 text-[11px] text-muted-foreground/70">{g.prompt || 'Sin prompt'}</p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/40">
                    <Icon className="size-3" aria-hidden />
                    <span>{g.status === 'done' ? `−${g.credits} cr` : g.status}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
