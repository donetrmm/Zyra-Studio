-- 059_character_outfits.sql
-- Vestuario por personaje (specs/v2/16): la maestra es head-and-shoulders y no
-- ancla la ropa. Cuerpo completo base + outfits intercambiables (variantes de
-- cuerpo completo con label). Espejo del patron character_states (045).

-- Cuerpo completo base del personaje (vestuario por defecto).
alter table characters
  add column if not exists full_body_image_id uuid references media_references(id) on delete set null;

create table character_outfits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  character_id uuid not null references characters(id) on delete cascade,
  label text not null,
  outfit_image_id uuid references media_references(id) on delete set null,
  description text,
  created_at timestamptz not null default now()
);
create index character_outfits_character_id_idx on character_outfits(character_id);

alter table character_outfits enable row level security;

drop policy if exists "character_outfits_read" on character_outfits;
create policy "character_outfits_read" on character_outfits for select
  using (is_workspace_member(workspace_id) or is_admin());

drop policy if exists "character_outfits_insert" on character_outfits;
create policy "character_outfits_insert" on character_outfits for insert
  with check (is_workspace_member(workspace_id));

drop policy if exists "character_outfits_update" on character_outfits;
create policy "character_outfits_update" on character_outfits for update
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

drop policy if exists "character_outfits_delete" on character_outfits;
create policy "character_outfits_delete" on character_outfits for delete
  using (is_workspace_member(workspace_id));

-- Outfit elegido por personaje para TODA la campaña: { [characterId]: outfitId }.
alter table campaigns
  add column if not exists character_outfit_map jsonb;

-- Override por clip, por LABEL (mismo patron que character_state_hint). null = el de campaña.
alter table campaign_items
  add column if not exists character_outfit_hint text;
