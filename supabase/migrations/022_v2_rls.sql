-- 022_v2_rls.sql
-- RLS para las tablas nuevas de V2. Recordatorio del repo: INSERT necesita
-- `with check`, no solo `using`. Helpers is_admin() / is_workspace_member()
-- existen desde 002.

alter table formats enable row level security;
alter table creative_templates enable row level security;
alter table scene_library enable row level security;
alter table campaign_items enable row level security;

-- ============ FORMATS ============
-- Sistema (workspace_id null): lectura para cualquier autenticado.
-- Propios: CRUD para miembros del workspace.
drop policy if exists "formats_read" on formats;
create policy "formats_read" on formats for select
  using (is_system or is_workspace_member(workspace_id) or is_admin());

drop policy if exists "formats_insert" on formats;
create policy "formats_insert" on formats for insert
  with check (not is_system and workspace_id is not null and is_workspace_member(workspace_id));

drop policy if exists "formats_update" on formats;
create policy "formats_update" on formats for update
  using (not is_system and is_workspace_member(workspace_id))
  with check (not is_system and is_workspace_member(workspace_id));

drop policy if exists "formats_delete" on formats;
create policy "formats_delete" on formats for delete
  using (not is_system and is_workspace_member(workspace_id));

-- ============ SCENE LIBRARY ============
drop policy if exists "scene_library_read" on scene_library;
create policy "scene_library_read" on scene_library for select
  using (is_system or is_workspace_member(workspace_id) or is_admin());

drop policy if exists "scene_library_insert" on scene_library;
create policy "scene_library_insert" on scene_library for insert
  with check (not is_system and workspace_id is not null and is_workspace_member(workspace_id));

drop policy if exists "scene_library_update" on scene_library;
create policy "scene_library_update" on scene_library for update
  using (not is_system and is_workspace_member(workspace_id))
  with check (not is_system and is_workspace_member(workspace_id));

drop policy if exists "scene_library_delete" on scene_library;
create policy "scene_library_delete" on scene_library for delete
  using (not is_system and is_workspace_member(workspace_id));

-- ============ CREATIVE TEMPLATES ============
drop policy if exists "creative_templates_read" on creative_templates;
create policy "creative_templates_read" on creative_templates for select
  using (is_workspace_member(workspace_id) or is_admin());

drop policy if exists "creative_templates_insert" on creative_templates;
create policy "creative_templates_insert" on creative_templates for insert
  with check (is_workspace_member(workspace_id));

drop policy if exists "creative_templates_update" on creative_templates;
create policy "creative_templates_update" on creative_templates for update
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

drop policy if exists "creative_templates_delete" on creative_templates;
create policy "creative_templates_delete" on creative_templates for delete
  using (is_workspace_member(workspace_id));

-- ============ CAMPAIGN ITEMS ============
-- Membresía vía la campaña padre. security definer en el helper evita
-- recursión de RLS sobre campaigns.
create or replace function is_campaign_member(c_id uuid) returns boolean as $$
  select exists(
    select 1
    from public.campaigns c
    join public.workspace_members wm on wm.workspace_id = c.workspace_id
    where c.id = c_id and wm.user_id = auth.uid()
  );
$$ language sql security definer stable set search_path = '';

drop policy if exists "campaign_items_read" on campaign_items;
create policy "campaign_items_read" on campaign_items for select
  using (is_campaign_member(campaign_id) or is_admin());

drop policy if exists "campaign_items_insert" on campaign_items;
create policy "campaign_items_insert" on campaign_items for insert
  with check (is_campaign_member(campaign_id));

drop policy if exists "campaign_items_update" on campaign_items;
create policy "campaign_items_update" on campaign_items for update
  using (is_campaign_member(campaign_id))
  with check (is_campaign_member(campaign_id));

drop policy if exists "campaign_items_delete" on campaign_items;
create policy "campaign_items_delete" on campaign_items for delete
  using (is_campaign_member(campaign_id));
