-- Conectar generaciones directamente a campañas (sin pasar por projects).
alter table generations add column if not exists campaign_id uuid references campaigns(id) on delete set null;
create index if not exists idx_gen_campaign on generations(campaign_id) where campaign_id is not null;
