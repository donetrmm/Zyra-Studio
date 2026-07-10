'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Plus } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { createStudioSessionAction } from '@/server-actions/studio';
import type { StudioSessionOption } from './types';

function sessionLabel(createdAt: string): string {
  const d = new Date(createdAt);
  return `Sesión · ${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString(
    'es-MX',
    { hour: '2-digit', minute: '2-digit' },
  )}`;
}

export function SessionHeader(props: {
  assetId: string;
  assetName: string;
  sessions: StudioSessionOption[];
  activeSessionId: string | null;
  defaultProvider: 'nano-banana' | 'gpt-image';
  defaultModelId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function goToSession(id: string) {
    router.push(`/app/studio/product/${props.assetId}?session=${id}`);
  }

  function newSession() {
    startTransition(async () => {
      const res = await createStudioSessionAction({
        assetType: 'product',
        assetId: props.assetId,
        provider: props.defaultProvider,
        modelId: props.defaultModelId,
      });
      if (!res.ok) {
        toast.error('No se pudo crear la sesión');
        return;
      }
      goToSession(res.data.id);
    });
  }

  return (
    <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
      <Link
        href="/app/brand"
        className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver
      </Link>
      <div className="min-w-0">
        <h1 className="truncate text-sm font-medium text-zinc-100">Estudio · {props.assetName}</h1>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {props.sessions.length > 0 && props.activeSessionId ? (
          <Select value={props.activeSessionId} onValueChange={goToSession}>
            <SelectTrigger className="h-8 w-[220px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.sessions.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-xs">
                  {sessionLabel(s.createdAt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          onClick={newSession}
          disabled={pending}
        >
          <Plus className="h-4 w-4" />
          Nueva sesión
        </Button>
      </div>
    </header>
  );
}
