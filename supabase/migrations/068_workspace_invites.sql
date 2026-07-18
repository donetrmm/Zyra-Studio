-- 068: equipos/colaboración fase 1 — invitaciones por link (specs/v2/20).
--
-- workspace_members existe desde 001 pero no había forma de poblarlo. Sin
-- email transaccional (restricción del alcance), la invitación es un LINK con
-- token de un solo uso que el owner comparte por donde quiera. El canje corre
-- en una función security definer: el invitado aún no es miembro, así que
-- ninguna policy le daría acceso a la tabla — el token ES la autorización.
--
-- Decisiones (2026-07-14): las invitaciones otorgan rol 'editor' (viewer
-- existe en el check de workspace_members pero no se ofrece hasta que haya
-- enforcement granular por rol); cada miembro consume SUS créditos.

create table if not exists workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  token text not null unique,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  created_by uuid references profiles(id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references profiles(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_ws_invites_workspace on workspace_invites(workspace_id, created_at desc);

alter table workspace_invites enable row level security;

-- Solo el owner del workspace gestiona invitaciones (mismo patrón que
-- ws_members_owner_write). El invitado nunca lee la tabla directo: usa las
-- funciones de abajo con el token.
drop policy if exists "ws_invites_owner_all" on workspace_invites;
create policy "ws_invites_owner_all" on workspace_invites
  for all using (
    exists(select 1 from workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
    or is_admin()
  );

-- Vista previa del invite para la página de canje: devuelve lo mínimo para
-- pintar "Te invitaron a X como editor" sin exponer la tabla.
create or replace function peek_workspace_invite(p_token text)
returns jsonb as $$
declare
  v_invite record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select i.id, i.role, i.expires_at, i.used_at, w.name as workspace_name
    into v_invite
    from workspace_invites i
    join workspaces w on w.id = i.workspace_id
    where i.token = p_token;
  if v_invite.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_invite.used_at is not null then
    return jsonb_build_object('status', 'used');
  end if;
  if v_invite.expires_at < now() then
    return jsonb_build_object('status', 'expired');
  end if;
  return jsonb_build_object(
    'status', 'valid',
    'workspaceName', v_invite.workspace_name,
    'role', v_invite.role
  );
end;
$$ language plpgsql security definer stable set search_path = public, pg_catalog;

-- Canje atómico: for update evita que dos canjes concurrentes del mismo token
-- pasen ambos; on conflict cubre al que ya era miembro.
create or replace function redeem_workspace_invite(p_token text)
returns jsonb as $$
declare
  v_invite record;
  v_user uuid;
  v_ws_name text;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select * into v_invite
    from workspace_invites
    where token = p_token
    for update;

  if v_invite.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_invite.used_at is not null then
    return jsonb_build_object('status', 'used');
  end if;
  if v_invite.expires_at < now() then
    return jsonb_build_object('status', 'expired');
  end if;

  select name into v_ws_name from workspaces where id = v_invite.workspace_id;

  if exists(
    select 1 from workspace_members
    where workspace_id = v_invite.workspace_id and user_id = v_user
  ) then
    return jsonb_build_object(
      'status', 'already_member',
      'workspaceId', v_invite.workspace_id,
      'workspaceName', v_ws_name
    );
  end if;

  insert into workspace_members(workspace_id, user_id, role)
    values (v_invite.workspace_id, v_user, v_invite.role)
    on conflict (workspace_id, user_id) do nothing;

  update workspace_invites
    set used_by = v_user, used_at = now()
    where id = v_invite.id;

  return jsonb_build_object(
    'status', 'joined',
    'workspaceId', v_invite.workspace_id,
    'workspaceName', v_ws_name,
    'role', v_invite.role
  );
end;
$$ language plpgsql security definer set search_path = public, pg_catalog;

revoke execute on function peek_workspace_invite(text) from public, anon;
revoke execute on function redeem_workspace_invite(text) from public, anon;
grant execute on function peek_workspace_invite(text) to authenticated;
grant execute on function redeem_workspace_invite(text) to authenticated;
