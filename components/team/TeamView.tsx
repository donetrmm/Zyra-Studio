'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeftRight, Check, Copy, Link2, Loader2, Trash2, UserMinus, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  createInviteAction,
  removeMemberAction,
  revokeInviteAction,
  setActiveWorkspaceAction,
} from '@/server-actions/team';

export type MemberRow = {
  userId: string;
  role: 'owner' | 'editor' | 'viewer';
  joinedAt: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
};

export type MembershipRow = {
  workspaceId: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
};

export type InviteRow = {
  id: string;
  token: string;
  role: string;
  expiresAt: string;
  createdAt: string;
};

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
};

export function TeamView({
  currentUserId,
  workspaceId,
  workspaceName,
  isOwner,
  members,
  memberships,
  invites,
}: {
  currentUserId: string;
  workspaceId: string;
  workspaceName: string;
  isOwner: boolean;
  members: MemberRow[];
  memberships: MembershipRow[];
  invites: InviteRow[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [creating, startCreate] = useTransition();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  function inviteUrl(token: string): string {
    return `${window.location.origin}/app/join/${token}`;
  }

  async function copyInvite(token: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
      toast.success('Link copiado — compártelo con tu invitado');
    } catch {
      toast.error('No se pudo copiar');
    }
  }

  function handleCreateInvite() {
    startCreate(async () => {
      const res = await createInviteAction();
      if (!res.ok) {
        toast.error(res.message ?? 'No se pudo crear la invitación');
        return;
      }
      await copyInvite(res.data.token);
      router.refresh();
    });
  }

  async function handleRevoke(inviteId: string) {
    const res = await revokeInviteAction({ inviteId });
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo revocar');
      return;
    }
    toast.success('Invitación revocada');
    router.refresh();
  }

  async function handleRemove(member: MemberRow) {
    const ok = await confirm({
      title: `¿Quitar a ${member.fullName ?? member.email} del equipo?`,
      description:
        'Pierde el acceso a este workspace. Lo que creó (generaciones, activos) se queda aquí.',
      confirmLabel: 'Quitar',
      destructive: true,
    });
    if (!ok) return;
    const res = await removeMemberAction({ userId: member.userId });
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo quitar al miembro');
      return;
    }
    toast.success('Miembro quitado');
    router.refresh();
  }

  async function handleSwitch(ws: MembershipRow) {
    const res = await setActiveWorkspaceAction({ workspaceId: ws.workspaceId });
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo cambiar de workspace');
      return;
    }
    toast.success(`Ahora estás en ${ws.name}`);
    router.push('/app');
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-heading text-[22px] font-semibold tracking-tight">Equipo</h1>
        <p className="text-[13px] text-muted-foreground">
          Miembros de {workspaceName}. Cada miembro genera con sus propios créditos.
        </p>
      </header>

      {memberships.length > 1 && (
        <section className="rounded-xl border border-border bg-muted/20 p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-foreground">
            <ArrowLeftRight className="size-3.5 text-muted-foreground" aria-hidden />
            Tus workspaces
          </h2>
          <div className="flex flex-wrap gap-2">
            {memberships.map((ws) => {
              const active = ws.workspaceId === workspaceId;
              return (
                <button
                  key={ws.workspaceId}
                  type="button"
                  disabled={active}
                  onClick={() => handleSwitch(ws)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                    active
                      ? 'cursor-default border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {ws.name}
                  <span className="text-[10.5px] text-muted-foreground/60">
                    {ROLE_LABEL[ws.role] ?? ws.role}
                  </span>
                  {active && <Check className="size-3 text-primary" aria-hidden />}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-[14px] font-medium text-foreground">
            <Users className="size-4 text-muted-foreground" aria-hidden />
            Miembros
            <span className="font-mono text-[12px] text-muted-foreground/60">{members.length}</span>
          </h2>
          {isOwner && (
            <button
              type="button"
              onClick={handleCreateInvite}
              disabled={creating}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Link2 className="size-3.5" aria-hidden />
              )}
              Generar link de invitación
            </button>
          )}
        </div>

        <ul className="divide-y divide-border rounded-xl border border-border">
          {members.map((m) => {
            const isSelf = m.userId === currentUserId;
            const initials = (m.fullName ?? m.email).slice(0, 2).toUpperCase();
            return (
              <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
                <Avatar className="size-8">
                  {m.avatarUrl ? <AvatarImage src={m.avatarUrl} alt={m.fullName ?? m.email} /> : null}
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-foreground">
                    {m.fullName ?? m.email.split('@')[0]}
                    {isSelf && <span className="ml-1.5 text-[11px] text-muted-foreground/60">(tú)</span>}
                  </div>
                  <div className="truncate text-[11.5px] text-muted-foreground">{m.email}</div>
                </div>
                <Badge variant={m.role === 'owner' ? 'default' : 'secondary'}>
                  {ROLE_LABEL[m.role] ?? m.role}
                </Badge>
                {isOwner && !isSelf && m.role !== 'owner' && (
                  <button
                    type="button"
                    onClick={() => handleRemove(m)}
                    title="Quitar del equipo"
                    className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                  >
                    <UserMinus className="size-3.5" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {isOwner && (
        <section>
          <h2 className="mb-3 text-[14px] font-medium text-foreground">
            Invitaciones pendientes
            <span className="ml-1.5 font-mono text-[12px] text-muted-foreground/60">
              {invites.length}
            </span>
          </h2>
          {invites.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[12.5px] text-muted-foreground">
              Sin invitaciones activas. Genera un link y compártelo: es de un solo
              uso y expira en 7 días.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {invites.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 px-4 py-3">
                  <Link2 className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[12px] text-foreground/80">
                      …/app/join/{inv.token.slice(0, 8)}…
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {ROLE_LABEL[inv.role] ?? inv.role} · expira{' '}
                      {new Date(inv.expiresAt).toLocaleDateString('es-MX', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyInvite(inv.token)}
                    title="Copiar link"
                    className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {copiedToken === inv.token ? (
                      <Check className="size-3.5 text-primary" aria-hidden />
                    ) : (
                      <Copy className="size-3.5" aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevoke(inv.id)}
                    title="Revocar invitación"
                    className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
