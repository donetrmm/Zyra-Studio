'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  archiveStudioSessionAction,
  createStudioSessionAction,
  renameStudioSessionAction,
} from '@/server-actions/studio';
import type { StudioProviderKind } from '@/lib/studio/model-options';
import type { StudioAssetType, StudioSessionOption } from './types';

const BACK_HREF: Record<StudioAssetType, string> = {
  product: '/app/brand/kits',
  location: '/app/brand/locations',
  character: '/app/brand/cast',
  panel: '/app/campaigns',
};

const TYPE_LABEL: Record<StudioAssetType, string> = {
  product: 'Producto',
  location: 'Locación',
  character: 'Personaje',
  panel: 'Panel',
};

// Etiqueta de sesión: el nombre que puso el usuario, o la fecha/hora si no tiene.
function sessionLabel(s: StudioSessionOption): string {
  if (s.title) return s.title;
  const d = new Date(s.createdAt);
  return `Sesión · ${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString(
    'es-MX',
    { hour: '2-digit', minute: '2-digit' },
  )}`;
}

export function SessionHeader(props: {
  assetType: StudioAssetType;
  assetId: string;
  assetName: string;
  sessions: StudioSessionOption[];
  activeSessionId: string | null;
  defaultProvider: StudioProviderKind;
  defaultModelId: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const activeSession = props.sessions.find((s) => s.id === props.activeSessionId) ?? null;

  function goToSession(id: string) {
    router.push(`/app/studio/${props.assetType}/${props.assetId}?session=${id}`);
  }

  function newSession() {
    startTransition(async () => {
      const res = await createStudioSessionAction({
        assetType: props.assetType,
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

  function openRename() {
    setRenameValue(activeSession?.title ?? '');
    setRenameOpen(true);
  }

  function submitRename() {
    const title = renameValue.trim();
    const sessionId = props.activeSessionId;
    if (!title || !sessionId) return;
    startTransition(async () => {
      const res = await renameStudioSessionAction({ sessionId, title });
      if (!res.ok) {
        toast.error(res.message ?? 'No se pudo renombrar');
        return;
      }
      setRenameOpen(false);
      toast.success('Sesión renombrada');
      router.refresh();
    });
  }

  async function handleDelete() {
    const sessionId = props.activeSessionId;
    if (!sessionId) return;
    const ok = await confirm({
      title: '¿Eliminar esta sesión?',
      description: 'Se quita del selector. Las imágenes generadas se conservan en la biblioteca.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await archiveStudioSessionAction(sessionId);
      if (!res.ok) {
        toast.error(res.message ?? 'No se pudo eliminar');
        return;
      }
      toast.success('Sesión eliminada');
      // Sin ?session: el RSC salta a la más reciente que quede o al estado limpio.
      router.push(`/app/studio/${props.assetType}/${props.assetId}`);
      router.refresh();
    });
  }

  return (
    <header className="flex items-center gap-3 border-b border-border px-4 py-3">
      <Link
        href={BACK_HREF[props.assetType]}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Volver</span>
      </Link>
      <div className="min-w-0">
        <p className="text-2xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Estudio · {TYPE_LABEL[props.assetType]}
        </p>
        <h1 className="truncate font-heading text-2sm font-semibold text-foreground">{props.assetName}</h1>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {props.sessions.length > 0 && props.activeSessionId ? (
          <Select value={props.activeSessionId} onValueChange={goToSession}>
            <SelectTrigger className="h-8 w-[150px] text-xs sm:w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.sessions.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-xs">
                  {sessionLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {props.activeSessionId ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={pending}>
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">Acciones de la sesión</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={openRename}>
                <Pencil className="mr-2 h-4 w-4" />
                Renombrar
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={handleDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          <span className="hidden sm:inline">Nueva sesión</span>
        </Button>
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Renombrar sesión</DialogTitle>
          </DialogHeader>
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename();
            }}
            placeholder="Nombre de la sesión"
            maxLength={60}
            autoFocus
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRenameOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={submitRename} disabled={pending || !renameValue.trim()}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
