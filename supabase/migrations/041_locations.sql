-- 041_locations.sql
-- Locaciones: activo reutilizable (espejo del Cast) = el "donde" de una secuencia.
-- Una secuencia con locacion se genera SIN encadenar; la locacion se re-ancla
-- como referencia environment en cada clip. Ver spec 2026-06-19-locaciones-base.

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  master_image_id uuid,                                         -- media_references.id (imagen del lugar)
  reference_image_ids uuid[] not null default array[]::uuid[],  -- angulos/detalles del lugar
  created_at timestamptz default now()
);
create index if not exists idx_locations_workspace on locations(workspace_id);

alter table locations enable row level security;
drop policy if exists "locations_member" on locations;
create policy "locations_member" on locations
  for all using (is_workspace_member(workspace_id) or is_admin());

alter table campaign_items
  add column if not exists location_id uuid references locations(id) on delete set null;
create index if not exists idx_campaign_items_location on campaign_items(location_id);

comment on table locations is
  'Locacion reutilizable (el "donde" de una secuencia). Su imagen se re-ancla como referencia environment en cada clip.';
comment on column campaign_items.location_id is
  'Locacion de la secuencia (compartida por todas sus escenas). No null => modo-locacion: la secuencia se genera SIN encadenar.';
