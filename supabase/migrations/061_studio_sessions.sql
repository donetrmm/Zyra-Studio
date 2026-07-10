-- 061 Estudio creativo de activos (Fase 1): sesiones + provider gpt-image + pricing.
-- Idempotente. NO se aplica dentro de las tareas; el controller la aplica vía MCP.

-- 1. Tabla de sesiones del estudio (agrupa generaciones de una iteración por activo).
create table if not exists studio_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  asset_type text not null check (asset_type in ('product', 'location', 'character')),
  asset_id uuid not null,
  default_provider text not null default 'nano-banana',
  default_model_id text not null default 'gemini-3-pro-image-preview',
  title text,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists studio_sessions_asset_idx
  on studio_sessions (workspace_id, asset_type, asset_id);

alter table studio_sessions enable row level security;

drop policy if exists "studio_sessions_member_read" on studio_sessions;
create policy "studio_sessions_member_read" on studio_sessions
  for select using (is_workspace_member(workspace_id) or is_admin());

drop policy if exists "studio_sessions_member_insert" on studio_sessions;
create policy "studio_sessions_member_insert" on studio_sessions
  for insert with check (is_workspace_member(workspace_id));

drop policy if exists "studio_sessions_member_update" on studio_sessions;
create policy "studio_sessions_member_update" on studio_sessions
  for update using (is_workspace_member(workspace_id) or is_admin());

drop policy if exists "studio_sessions_member_delete" on studio_sessions;
create policy "studio_sessions_member_delete" on studio_sessions
  for delete using (is_workspace_member(workspace_id) or is_admin());

-- 2. Etiqueta de sesión en generations (una generación = un turno del chat).
alter table generations
  add column if not exists studio_session_id uuid references studio_sessions(id) on delete set null;

create index if not exists generations_studio_session_idx
  on generations (studio_session_id);

-- 3. Extender el CHECK de provider para aceptar gpt-image (recrear el constraint).
alter table generations drop constraint if exists generations_provider_check;
alter table generations add constraint generations_provider_check
  check (provider in ('veo', 'kling', 'nano-banana', 'flux', 'elevenlabs', 'seedance', 'gpt-image'));

-- 4. Pricing de GPT Image (plano por imagen; variant = calidad para gpt-image-2).
insert into model_pricing (provider, model_id, variant, credits_cost, unit_size, unit_label) values
  ('gpt-image', 'gpt-image-2',      'low',     70,  null, null),
  ('gpt-image', 'gpt-image-2',      'medium',  110, null, null),
  ('gpt-image', 'gpt-image-2',      'high',    180, null, null),
  ('gpt-image', 'gpt-image-1',      'default', 60,  null, null),
  ('gpt-image', 'gpt-image-1-mini', 'default', 30,  null, null)
on conflict (provider, model_id, variant) do nothing;
