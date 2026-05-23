-- 002_rls_policies.sql
-- Habilita RLS + helpers is_admin / is_workspace_member + policies completas.
-- Patrón: `drop policy if exists` antes de `create policy` para idempotencia.

-- ============ ENABLE RLS ============
alter table profiles               enable row level security;
alter table credit_balances        enable row level security;
alter table credit_transactions    enable row level security;
alter table workspaces             enable row level security;
alter table workspace_members      enable row level security;
alter table campaigns              enable row level security;
alter table projects               enable row level security;
alter table generations            enable row level security;
alter table media_references       enable row level security;
alter table collections            enable row level security;
alter table collection_items       enable row level security;
alter table voice_clones           enable row level security;
alter table brand_kits             enable row level security;
alter table characters             enable row level security;
alter table presets                enable row level security;
alter table credit_purchases       enable row level security;
alter table model_pricing          enable row level security;
alter table notifications          enable row level security;
alter table admin_audit_log        enable row level security;

-- ============ HELPERS ============
create or replace function is_admin() returns boolean as $$
  select exists(
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

create or replace function is_workspace_member(ws_id uuid) returns boolean as $$
  select exists(
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$ language sql security definer stable;

-- ============ PROFILES ============
drop policy if exists "profiles_self_read"   on profiles;
drop policy if exists "profiles_self_update" on profiles;
drop policy if exists "profiles_admin_all"   on profiles;
create policy "profiles_self_read"   on profiles for select using (id = auth.uid() or is_admin());
create policy "profiles_self_update" on profiles for update using (id = auth.uid());
create policy "profiles_admin_all"   on profiles for all    using (is_admin());

-- ============ CREDIT BALANCES ============
drop policy if exists "balances_self_read"   on credit_balances;
drop policy if exists "balances_admin_write" on credit_balances;
create policy "balances_self_read"   on credit_balances for select using (user_id = auth.uid() or is_admin());
create policy "balances_admin_write" on credit_balances for all    using (is_admin());

-- ============ CREDIT TRANSACTIONS ============
-- Insert vía security definer functions o service_role. Bloqueamos insert directo.
drop policy if exists "tx_self_read"        on credit_transactions;
drop policy if exists "tx_admin_only_write" on credit_transactions;
create policy "tx_self_read"        on credit_transactions for select using (user_id = auth.uid() or is_admin());
create policy "tx_admin_only_write" on credit_transactions for insert with check (is_admin());

-- ============ WORKSPACES ============
drop policy if exists "ws_member_read" on workspaces;
drop policy if exists "ws_owner_write" on workspaces;
create policy "ws_member_read" on workspaces for select using (is_workspace_member(id) or is_admin());
create policy "ws_owner_write" on workspaces for all    using (owner_id = auth.uid() or is_admin());

-- ============ WORKSPACE MEMBERS ============
drop policy if exists "ws_members_read"        on workspace_members;
drop policy if exists "ws_members_owner_write" on workspace_members;
create policy "ws_members_read" on workspace_members
  for select using (is_workspace_member(workspace_id) or is_admin());
create policy "ws_members_owner_write" on workspace_members
  for all using (
    exists(select 1 from workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
    or is_admin()
  );

-- ============ CAMPAIGNS / PROJECTS ============
drop policy if exists "campaigns_member" on campaigns;
drop policy if exists "projects_member"  on projects;
create policy "campaigns_member" on campaigns for all using (is_workspace_member(workspace_id) or is_admin());
create policy "projects_member"  on projects  for all using (
  exists(select 1 from campaigns c where c.id = campaign_id and is_workspace_member(c.workspace_id))
  or is_admin()
);

-- ============ GENERATIONS ============
drop policy if exists "generations_member_read"   on generations;
drop policy if exists "generations_member_insert" on generations;
drop policy if exists "generations_owner_update"  on generations;
drop policy if exists "generations_owner_delete"  on generations;
create policy "generations_member_read"   on generations for select using (is_workspace_member(workspace_id) or is_admin());
create policy "generations_member_insert" on generations for insert with check (is_workspace_member(workspace_id) and user_id = auth.uid());
create policy "generations_owner_update"  on generations for update using (user_id = auth.uid() or is_admin());
create policy "generations_owner_delete"  on generations for delete using (user_id = auth.uid() or is_admin());

-- ============ MEDIA REFERENCES ============
drop policy if exists "media_refs_member_read"   on media_references;
drop policy if exists "media_refs_member_insert" on media_references;
drop policy if exists "media_refs_owner_update"  on media_references;
drop policy if exists "media_refs_owner_delete"  on media_references;
create policy "media_refs_member_read"   on media_references for select using (is_workspace_member(workspace_id) or is_admin());
create policy "media_refs_member_insert" on media_references for insert with check (is_workspace_member(workspace_id) and user_id = auth.uid());
create policy "media_refs_owner_update"  on media_references for update using (user_id = auth.uid() or is_admin());
create policy "media_refs_owner_delete"  on media_references for delete using (user_id = auth.uid() or is_admin());

-- ============ COLLECTIONS ============
drop policy if exists "collections_member"      on collections;
drop policy if exists "collection_items_member" on collection_items;
create policy "collections_member" on collections for all using (is_workspace_member(workspace_id) or is_admin());
create policy "collection_items_member" on collection_items for all using (
  exists(select 1 from collections c where c.id = collection_id and is_workspace_member(c.workspace_id))
  or is_admin()
);

-- ============ BRAND KITS / CHARACTERS / VOICE CLONES ============
drop policy if exists "brand_kits_member" on brand_kits;
drop policy if exists "characters_member" on characters;
drop policy if exists "voices_owner"      on voice_clones;
create policy "brand_kits_member" on brand_kits  for all using (is_workspace_member(workspace_id) or is_admin());
create policy "characters_member" on characters  for all using (is_workspace_member(workspace_id) or is_admin());
create policy "voices_owner"      on voice_clones for all using (user_id = auth.uid() or is_admin());

-- ============ PRESETS ============
drop policy if exists "presets_read"  on presets;
drop policy if exists "presets_write" on presets;
create policy "presets_read"  on presets for select using (is_public or user_id = auth.uid() or is_admin());
create policy "presets_write" on presets for all    using (user_id = auth.uid() or is_admin());

-- ============ CREDIT PURCHASES ============
drop policy if exists "purchases_self"         on credit_purchases;
drop policy if exists "purchases_create"       on credit_purchases;
drop policy if exists "purchases_admin_update" on credit_purchases;
create policy "purchases_self"         on credit_purchases for select using (user_id = auth.uid() or is_admin());
create policy "purchases_create"       on credit_purchases for insert with check (user_id = auth.uid());
create policy "purchases_admin_update" on credit_purchases for update using (is_admin());

-- ============ MODEL PRICING ============
-- Lectura pública (estimador en cliente). Mutación solo admin.
drop policy if exists "pricing_read"         on model_pricing;
drop policy if exists "pricing_admin_insert" on model_pricing;
drop policy if exists "pricing_admin_update" on model_pricing;
drop policy if exists "pricing_admin_delete" on model_pricing;
create policy "pricing_read"         on model_pricing for select using (true);
create policy "pricing_admin_insert" on model_pricing for insert with check (is_admin());
create policy "pricing_admin_update" on model_pricing for update using (is_admin());
create policy "pricing_admin_delete" on model_pricing for delete using (is_admin());

-- ============ NOTIFICATIONS ============
drop policy if exists "notif_self_read"     on notifications;
drop policy if exists "notif_self_update"   on notifications;
drop policy if exists "notif_admin_insert"  on notifications;
create policy "notif_self_read"    on notifications for select using (user_id = auth.uid() or is_admin());
create policy "notif_self_update"  on notifications for update using (user_id = auth.uid());
create policy "notif_admin_insert" on notifications for insert with check (is_admin());

-- ============ AUDIT LOG ============
drop policy if exists "audit_admin" on admin_audit_log;
create policy "audit_admin" on admin_audit_log for all using (is_admin());
