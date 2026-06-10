-- 019_v2_formats_templates.sql
-- Fase A de V2 (specs/v2/01-fundacion-v2.md): formatos creativos Zyra,
-- plantillas vivas y biblioteca de escenas. Van antes que campaign_items (020)
-- porque este referencia a formats y creative_templates por FK.

-- ============ FORMATOS CREATIVOS ============
-- Taxonomía propia (doc V2 §4.2). Las filas de sistema tienen workspace_id null
-- y se seedean en 023; los workspaces pueden crear formatos propios.
create table if not exists formats (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  register text,                 -- registro narrativo (casual, documental, premium...)
  camera_style text,             -- lenguaje de cámara por defecto del formato
  pacing text,                   -- ritmo (pausado, beat-driven, single-take...)
  required_refs text[] not null default array[]::text[],  -- 'product' | 'character' | 'packaging'
  default_duration_s integer not null default 8
    check (default_duration_s between 4 and 15),
  default_audio boolean not null default true,
  is_system boolean not null default false,
  workspace_id uuid references workspaces(id) on delete cascade,
  created_at timestamptz default now(),
  -- una fila es de sistema XOR de un workspace
  check ((is_system and workspace_id is null) or (not is_system and workspace_id is not null))
);

-- ============ PLANTILLAS VIVAS ============
-- Un creativo ganador destilado en plantilla reutilizable (doc V2 §4.2).
-- Distinto de `presets` (V1): presets guarda params sueltos del usuario;
-- creative_templates guarda estructura + slots rotables con video de origen
-- como referencia de cámara/ritmo.
create table if not exists creative_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  source_generation_id uuid references generations(id) on delete set null,
  format_id uuid references formats(id) on delete set null,
  fixed_params jsonb not null,   -- model_slug, duración, ratio, tier, seed, estilo
  slots jsonb not null,          -- producto, variante, escena, personaje
  uses_count integer not null default 0,
  created_at timestamptz default now()
);

-- ============ BIBLIOTECA DE ESCENAS ============
-- Sugerencias, no restricción (doc V2 §3): el usuario puede pedir cualquier
-- escena; el validador del Prompt Director decide producibilidad.
create table if not exists scene_library (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('escena', 'gancho')),
  name text not null,
  prompt_fragment text not null,  -- fragmento en inglés listo para compilar
  is_system boolean not null default false,
  workspace_id uuid references workspaces(id) on delete cascade,
  created_at timestamptz default now(),
  check ((is_system and workspace_id is null) or (not is_system and workspace_id is not null))
);

create index if not exists idx_formats_workspace on formats(workspace_id) where workspace_id is not null;
create index if not exists idx_templates_workspace on creative_templates(workspace_id);
create index if not exists idx_scene_library_type on scene_library(type);
