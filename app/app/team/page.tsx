import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { TeamView, type InviteRow, type MemberRow, type MembershipRow } from '@/components/team/TeamView';

export const metadata: Metadata = {
  title: 'Equipo',
};

export default async function TeamPage() {
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();
  const isOwner = workspace.role === 'owner';

  const [membersRes, membershipsRes, invitesRes] = await Promise.all([
    supabase
      .from('workspace_members')
      .select('user_id, role, created_at, profiles!inner(email, full_name, avatar_url)')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('workspace_members')
      .select('workspace_id, role, workspaces!inner(name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true }),
    // Invitaciones: solo el owner las ve (RLS también lo garantiza).
    isOwner
      ? supabase
          .from('workspace_invites')
          .select('id, token, role, expires_at, used_at, created_at')
          .eq('workspace_id', workspace.id)
          .is('used_at', null)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const members: MemberRow[] = (membersRes.data ?? []).map((m) => {
    const profile = m.profiles as unknown as {
      email: string;
      full_name: string | null;
      avatar_url: string | null;
    };
    return {
      userId: m.user_id as string,
      role: m.role as 'owner' | 'editor' | 'viewer',
      joinedAt: m.created_at as string,
      email: profile.email,
      fullName: profile.full_name,
      avatarUrl: profile.avatar_url,
    };
  });

  const memberships: MembershipRow[] = (membershipsRes.data ?? []).map((m) => ({
    workspaceId: m.workspace_id as string,
    name: (m.workspaces as unknown as { name: string }).name,
    role: m.role as 'owner' | 'editor' | 'viewer',
  }));

  const invites: InviteRow[] = (invitesRes.data ?? []).map((i) => ({
    id: i.id as string,
    token: i.token as string,
    role: i.role as string,
    expiresAt: i.expires_at as string,
    createdAt: i.created_at as string,
  }));

  return (
    <div className="mx-auto w-full max-w-4xl">
      <TeamView
        currentUserId={user.id}
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        isOwner={isOwner}
        members={members}
        memberships={memberships}
        invites={invites}
      />
    </div>
  );
}
