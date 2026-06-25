-- 045_character_states.sql
-- P05: variantes de estado fisico del personaje (mojado/sudado/...), como
-- referencias distintas. NO columnas en characters (no romper el contrato master).
create table character_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  character_id uuid not null references characters(id) on delete cascade,
  label text not null,
  state_image_id uuid references media_references(id) on delete set null,
  description text,
  created_at timestamptz not null default now()
);
create index character_states_character_id_idx on character_states(character_id);

alter table character_states enable row level security;

-- RLS member-scoped: espeja el patron de characters (002_rls_policies.sql),
-- desglosado en 4 policies por operacion (patron 022_v2_rls.sql).
drop policy if exists "character_states_read" on character_states;
create policy "character_states_read" on character_states for select
  using (is_workspace_member(workspace_id) or is_admin());

drop policy if exists "character_states_insert" on character_states;
create policy "character_states_insert" on character_states for insert
  with check (is_workspace_member(workspace_id));

drop policy if exists "character_states_update" on character_states;
create policy "character_states_update" on character_states for update
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

drop policy if exists "character_states_delete" on character_states;
create policy "character_states_delete" on character_states for delete
  using (is_workspace_member(workspace_id));

-- El hint de estado por escena (label exacto o null). Vive en el item porque el
-- orchestrator lo consume en GENERACION (directorContextFor), no en plan.
alter table campaign_items add column character_state_hint text;
