'use server';

import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireUser, requireWorkspace, ACTIVE_WORKSPACE_COOKIE } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import {
  RedeemInviteSchema,
  RemoveMemberSchema,
  RevokeInviteSchema,
  SetActiveWorkspaceSchema,
} from '@/lib/schemas/team';

// Equipos fase 1 (specs/v2/20): invitaciones por link de un solo uso, rol
// 'editor', cada miembro consume sus propios créditos. Solo el owner del
// workspace gestiona el equipo — RLS (ws_invites_owner_all,
// ws_members_owner_write) es la segunda línea detrás de estos checks.

type ActionError = 'validation_error' | 'forbidden' | 'not_found' | 'internal_error';
type Result<T> = { ok: true; data: T } | { ok: false; error: ActionError; message?: string };

const INVITE_TTL_DAYS = 7;

export async function createInviteAction(): Promise<
  Result<{ inviteId: string; token: string; path: string; expiresAt: string }>
> {
  const { user, workspace } = await requireWorkspace();
  if (workspace.role !== 'owner') {
    return { ok: false, error: 'forbidden', message: 'Solo el owner puede invitar' };
  }

  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('workspace_invites')
    .insert({
      workspace_id: workspace.id,
      token,
      role: 'editor',
      created_by: user.id,
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (error || !data) {
    return { ok: false, error: 'internal_error', message: error?.message ?? 'no row' };
  }

  revalidatePath('/app/team');
  return {
    ok: true,
    data: { inviteId: data.id as string, token, path: `/app/join/${token}`, expiresAt },
  };
}

export async function revokeInviteAction(input: unknown): Promise<Result<{ revoked: true }>> {
  const parsed = RevokeInviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error' };
  const { workspace } = await requireWorkspace();
  if (workspace.role !== 'owner') {
    return { ok: false, error: 'forbidden', message: 'Solo el owner puede revocar' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('workspace_invites')
    .delete()
    .eq('id', parsed.data.inviteId)
    .eq('workspace_id', workspace.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };

  revalidatePath('/app/team');
  return { ok: true, data: { revoked: true } };
}

export async function removeMemberAction(input: unknown): Promise<Result<{ removed: true }>> {
  const parsed = RemoveMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error' };
  const { user, workspace } = await requireWorkspace();
  if (workspace.role !== 'owner') {
    return { ok: false, error: 'forbidden', message: 'Solo el owner puede quitar miembros' };
  }
  if (parsed.data.userId === user.id || parsed.data.userId === workspace.ownerId) {
    return { ok: false, error: 'forbidden', message: 'El owner no se puede quitar a sí mismo' };
  }

  // Lo que el miembro creó (generaciones, activos) queda en el workspace: las
  // FKs apuntan al workspace, no a la membresía. Solo pierde el acceso.
  const supabase = await createClient();
  const { error } = await supabase
    .from('workspace_members')
    .delete()
    .eq('workspace_id', workspace.id)
    .eq('user_id', parsed.data.userId);
  if (error) return { ok: false, error: 'internal_error', message: error.message };

  revalidatePath('/app/team');
  return { ok: true, data: { removed: true } };
}

export type RedeemResult = {
  status: 'joined' | 'already_member' | 'not_found' | 'used' | 'expired';
  workspaceId?: string;
  workspaceName?: string;
};

export async function redeemInviteAction(input: unknown): Promise<Result<RedeemResult>> {
  const parsed = RedeemInviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error' };
  await requireUser();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('redeem_workspace_invite', {
    p_token: parsed.data.token,
  });
  if (error) return { ok: false, error: 'internal_error', message: error.message };

  const result = (data ?? {}) as RedeemResult;
  if ((result.status === 'joined' || result.status === 'already_member') && result.workspaceId) {
    // Activar el workspace recién unido para que el redirect aterrice ahí.
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, result.workspaceId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
    revalidatePath('/app', 'layout');
  }
  return { ok: true, data: result };
}

export async function setActiveWorkspaceAction(input: unknown): Promise<Result<{ set: true }>> {
  const parsed = SetActiveWorkspaceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error' };
  const user = await requireUser();

  // Validar membresía ANTES de setear la cookie (el DAL re-valida igual, pero
  // aquí devolvemos un error accionable en vez de un fallback silencioso).
  const supabase = await createClient();
  const { data } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .eq('workspace_id', parsed.data.workspaceId)
    .maybeSingle();
  if (!data) return { ok: false, error: 'not_found', message: 'No eres miembro de ese workspace' };

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, parsed.data.workspaceId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/app', 'layout');
  return { ok: true, data: { set: true } };
}
