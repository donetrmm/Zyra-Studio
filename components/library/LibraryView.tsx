'use client';

import { useMemo, useState } from 'react';
import { Coins, Filter, Image as ImageIcon } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GenerationDetailDialog } from './GenerationDetailDialog';
import { cn } from '@/lib/utils';

export type LibraryGeneration = {
  id: string;
  type: string;
  provider: string;
  model: string;
  prompt: string;
  status: string;
  thumbnailUrl: string | null;
  hasOutput: boolean;
  credits: number;
  createdAt: string;
};

export type LibraryReference = {
  id: string;
  type: string;
  storagePath: string;
  name: string | null;
  source: string;
  createdAt: string;
};

type Filter = 'all' | 'image' | 'video' | 'audio';
type ProviderFilter = 'all' | 'nano-banana' | 'flux' | 'veo' | 'kling' | 'elevenlabs';

export function LibraryView({
  generations,
  references,
}: {
  generations: LibraryGeneration[];
  references: LibraryReference[];
}) {
  const [type, setType] = useState<Filter>('all');
  const [provider, setProvider] = useState<ProviderFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return generations.filter((g) => {
      if (type !== 'all' && g.type !== type) return false;
      if (provider !== 'all' && g.provider !== provider) return false;
      return true;
    });
  }, [generations, type, provider]);

  return (
    <Tabs defaultValue="generations" className="space-y-4">
      <TabsList>
        <TabsTrigger value="generations">
          Generaciones ({generations.length})
        </TabsTrigger>
        <TabsTrigger value="references">
          Referencias ({references.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="generations" className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="size-4 text-muted-foreground" aria-hidden />
          <Select value={type} onValueChange={(v) => setType(v as Filter)}>
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              <SelectItem value="image">Imagen</SelectItem>
              <SelectItem value="video">Video</SelectItem>
              <SelectItem value="audio">Audio</SelectItem>
            </SelectContent>
          </Select>
          <Select value={provider} onValueChange={(v) => setProvider(v as ProviderFilter)}>
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los modelos</SelectItem>
              <SelectItem value="nano-banana">Nano Banana</SelectItem>
              <SelectItem value="flux">FLUX</SelectItem>
              <SelectItem value="veo">Veo</SelectItem>
              <SelectItem value="kling">Kling</SelectItem>
              <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filtered.map((g) => (
              <GenerationCard
                key={g.id}
                generation={g}
                onClick={() => setOpenId(g.id)}
              />
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="references">
        {references.length === 0 ? (
          <EmptyReferences />
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {references.map((r) => (
              <Card key={r.id} className="aspect-square overflow-hidden p-0">
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  {r.name ?? r.type}
                </div>
              </Card>
            ))}
          </div>
        )}
      </TabsContent>

      <GenerationDetailDialog
        id={openId}
        onOpenChange={(open) => !open && setOpenId(null)}
      />
    </Tabs>
  );
}

function GenerationCard({
  generation,
  onClick,
}: {
  generation: LibraryGeneration;
  onClick: () => void;
}) {
  const isDone = generation.status === 'done';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative aspect-square overflow-hidden rounded-md border border-border bg-muted text-left transition-colors hover:border-primary/60',
      )}
    >
      {generation.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={generation.thumbnailUrl}
          alt=""
          className="size-full object-cover transition-transform group-hover:scale-105"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          {generation.status}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-background/90 via-background/60 to-transparent p-2">
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          <Badge variant="outline" className="h-4 px-1.5 py-0">
            {generation.provider}
          </Badge>
          {isDone && (
            <Badge variant="outline" className="h-4 gap-0.5 px-1.5 py-0">
              <Coins className="size-2.5" aria-hidden /> {generation.credits}
            </Badge>
          )}
          {!isDone && (
            <Badge variant="secondary" className="h-4 px-1.5 py-0">
              {generation.status}
            </Badge>
          )}
        </div>
        <p className="line-clamp-1 text-[11px] text-foreground">{generation.prompt}</p>
      </div>
    </button>
  );
}

function EmptyState() {
  return (
    <Card className="flex flex-col items-center gap-3 border-dashed p-10 text-center">
      <ImageIcon className="size-8 text-muted-foreground" aria-hidden />
      <p className="font-medium">Aún no hay generaciones</p>
      <p className="text-sm text-muted-foreground">
        Crea tu primera imagen desde el panel de generación.
      </p>
    </Card>
  );
}

function EmptyReferences() {
  return (
    <Card className="flex flex-col items-center gap-3 border-dashed p-10 text-center">
      <ImageIcon className="size-8 text-muted-foreground" aria-hidden />
      <p className="font-medium">Sin referencias</p>
      <p className="text-sm text-muted-foreground">
        Sube imágenes desde el panel de creación para reutilizarlas.
      </p>
    </Card>
  );
}
