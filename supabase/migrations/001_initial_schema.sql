-- 001_initial_schema.sql
-- Schema completo de Zyra Studio. Tablas en orden de dependencias:
-- identidad → organización → assets reutilizables → generations → resto.

-- ============ IDENTIDAD ============
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  avatar_url text,
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  area text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists credit_balances (
  user_id uuid primary key references profiles(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  pending bigint not null default 0 check (pending >= 0),
  updated_at timestamptz default now()
);

create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  delta bigint not null,
  reason text not null,
  generation_id uuid,
  admin_id uuid references profiles(id) on delete set null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_credit_tx_user on credit_transactions(user_id, created_at desc);

-- ============ ORGANIZACIÓN ============
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz default now(),
  primary key (workspace_id, user_id)
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  color text default '#7c3aed',
  cover_url text,
  created_at timestamptz default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name text not null,
  brief text,
  status text default 'draft' check (status in ('draft', 'in_progress', 'done', 'archived')),
  created_at timestamptz default now()
);

-- ============ ASSETS REUTILIZABLES ============
-- Deben existir antes de generations porque generations.brand_kit_id es FK.
create table if not exists brand_kits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  colors jsonb default '[]'::jsonb,
  fonts jsonb default '[]'::jsonb,
  logo_url text,
  tone_description text,
  style_guidelines text,
  reference_image_ids uuid[] default array[]::uuid[],
  created_at timestamptz default now()
);

create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  reference_image_ids uuid[] not null default array[]::uuid[],
  created_at timestamptz default now()
);

create table if not exists voice_clones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete set null,
  name text not null,
  description text,
  elevenlabs_voice_id text unique,
  sample_storage_url text,
  status text default 'pending' check (status in ('pending', 'ready', 'failed')),
  created_at timestamptz default now()
);

-- ============ GENERACIONES ============
create table if not exists generations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  user_id uuid not null references profiles(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,

  type text not null check (type in ('video', 'image', 'audio')),
  provider text not null check (provider in ('veo', 'kling', 'nano-banana', 'flux', 'elevenlabs')),
  model_id text not null,

  prompt text,
  negative_prompt text,
  params jsonb not null default '{}'::jsonb,
  reference_ids uuid[] default array[]::uuid[],
  brand_kit_id uuid references brand_kits(id) on delete set null,
  character_ids uuid[] default array[]::uuid[],

  status text not null default 'queued' check (status in ('queued', 'processing', 'done', 'failed', 'canceled')),
  provider_task_id text,
  provider_payload jsonb,
  error_message text,
  poll_attempts integer not null default 0,
  timeout_at timestamptz,
  cancel_requested boolean not null default false,

  output_url text,
  thumbnail_url text,
  duration_seconds numeric,
  file_size_bytes bigint,

  credits_estimated bigint not null,
  credits_charged bigint,
  processing_ms integer,

  parent_generation_id uuid references generations(id) on delete set null,
  batch_id uuid,
  batch_kind text check (batch_kind in ('storyboard', 'variations', 'smart_crop', 'lipsync_pipeline')),

  created_at timestamptz default now(),
  completed_at timestamptz
);

create index if not exists idx_gen_user on generations(user_id, created_at desc);
create index if not exists idx_gen_project on generations(project_id);
create index if not exists idx_gen_status on generations(status) where status in ('queued', 'processing');
create index if not exists idx_gen_parent on generations(parent_generation_id);
create index if not exists idx_gen_batch on generations(batch_id) where batch_id is not null;

-- ============ REFERENCIAS Y ASSETS ============
-- `references` es palabra reservada → media_references.
create table if not exists media_references (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('image', 'audio', 'video')),
  storage_url text not null,
  thumbnail_url text,
  name text,
  tags text[] default array[]::text[],
  notes text,
  source text default 'upload' check (source in ('upload', 'generation')),
  source_generation_id uuid references generations(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists collection_items (
  collection_id uuid not null references collections(id) on delete cascade,
  generation_id uuid not null references generations(id) on delete cascade,
  added_at timestamptz default now(),
  primary key (collection_id, generation_id)
);

-- ============ PRESETS ============
create table if not exists presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  type text not null check (type in ('video', 'image', 'audio')),
  name text not null,
  description text,
  params jsonb not null,
  is_public boolean default false,
  uses_count integer default 0,
  created_at timestamptz default now()
);

-- ============ COMPRAS SIMBÓLICAS (sin Stripe) ============
create table if not exists credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  pack_id text not null check (pack_id in ('starter','creator','pro','studio')),
  credits bigint not null,
  price_mxn numeric(10,2) not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  constraint pack_catalog_match check (
    (pack_id = 'starter' and credits =   2000 and price_mxn =   99) or
    (pack_id = 'creator' and credits =  10000 and price_mxn =  399) or
    (pack_id = 'pro'     and credits =  50000 and price_mxn = 1499) or
    (pack_id = 'studio'  and credits = 200000 and price_mxn = 4999)
  )
);

-- ============ PRECIOS DE MODELOS ============
create table if not exists model_pricing (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model_id text not null,
  variant text not null default 'default',
  credits_cost bigint not null,
  unit_size integer,
  unit_label text,
  is_active boolean default true,
  updated_at timestamptz default now(),
  updated_by uuid references profiles(id) on delete set null,
  unique(provider, model_id, variant)
);

-- ============ NOTIFICACIONES IN-APP ============
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  payload jsonb default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_notif_user_unread on notifications(user_id, created_at desc) where read_at is null;

-- ============ AUDITORÍA ADMIN ============
create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  -- Spec original tenía admin_id NOT NULL; relajamos a nullable para que
  -- `on delete set null` funcione si alguna vez se hace hard-delete de un
  -- admin (en práctica usamos soft delete via profiles.status='deleted').
  admin_id uuid references profiles(id) on delete set null,
  action text not null,
  target_user_id uuid references profiles(id) on delete set null,
  target_resource_id uuid,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_audit_admin on admin_audit_log(admin_id, created_at desc);
