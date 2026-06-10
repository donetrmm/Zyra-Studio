-- 020_v2_campaigns.sql
-- Fase A de V2: campaigns pasa de carpeta ligera (V1) a entidad orquestable,
-- y nace campaign_items (el plan de la campaña, una fila por creativo).
-- Extiende, no recrea: las columnas V1 (name, description, color, cover_url) siguen.

-- ============ CAMPAIGNS: columnas de orquestación ============
alter table campaigns
  add column if not exists goal text
    check (goal is null or goal in ('awareness', 'conversion', 'mixed')),
  add column if not exists market text,
  add column if not exists product_brief jsonb,   -- auto-detección: categoría, variantes, paleta, demográfico
  add column if not exists date_start date,
  add column if not exists date_end date,
  add column if not exists status text not null default 'draft'
    check (status in ('draft', 'planned', 'producing', 'delivered', 'archived')),
  add column if not exists total_items integer not null default 0,
  add column if not exists credits_estimated integer;

-- ============ CAMPAIGN ITEMS ============
-- Un creativo planificado. Su generación real es una fila normal de
-- `generations` (cola V1); aquí vive el contexto de campaña.
create table if not exists campaign_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  format_id uuid references formats(id) on delete set null,
  template_id uuid references creative_templates(id) on delete set null,
  model_slug text not null,
  duration_s integer check (duration_s is null or duration_s between 4 and 15),
  aspect_ratio text,
  scene text,
  audio boolean not null default true,
  character_id uuid references characters(id) on delete set null,
  scene_prompt text not null,
  caption text,                   -- metadato para publicar; NUNCA texto en pantalla
  scheduled_date date,
  status text not null default 'planned'
    check (status in ('planned', 'sample', 'queued', 'draft_ready', 'approved', 'final_ready', 'failed', 'skipped')),
  generation_id uuid references generations(id) on delete set null,
  warnings jsonb default '[]'::jsonb,  -- avisos del validador de producibilidad
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_campaign_items_campaign on campaign_items(campaign_id);
create index if not exists idx_campaign_items_status on campaign_items(campaign_id, status);

-- updated_at automático (touch_updated_at existe desde 003)
drop trigger if exists trg_campaign_items_touch on campaign_items;
create trigger trg_campaign_items_touch
  before update on campaign_items
  for each row execute function touch_updated_at();
