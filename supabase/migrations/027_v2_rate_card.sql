-- 027_v2_rate_card.sql
-- Fase E de V2: (1) rate card propia para el reporte de valor (editable en
-- admin; valores iniciales propios, no copiados de terceros), (2) retención:
-- el cleanup diario purga drafts superados por su render final.

-- ============ 1. Rate card ============
create table if not exists value_rate_card (
  id uuid primary key default gen_random_uuid(),
  asset_type text unique not null,   -- slug del formato o tipo de imagen
  label text not null,
  low_usd numeric not null check (low_usd >= 0),
  mid_usd numeric not null check (mid_usd >= low_usd),
  high_usd numeric not null check (high_usd >= mid_usd),
  active boolean not null default true,
  updated_at timestamptz default now()
);

alter table value_rate_card enable row level security;

-- Config global: lectura para cualquier autenticado (el reporte la usa);
-- escritura solo admin.
drop policy if exists "rate_card_read" on value_rate_card;
create policy "rate_card_read" on value_rate_card for select
  using (auth.role() = 'authenticated');

drop policy if exists "rate_card_admin_write" on value_rate_card;
create policy "rate_card_admin_write" on value_rate_card for all
  using (is_admin()) with check (is_admin());

-- Valores iniciales: estimación propia de producción tradicional (USD,
-- rango low-mid-high). Son punto de partida editable, no una cotización.
insert into value_rate_card (asset_type, label, low_usd, mid_usd, high_usd) values
  ('voz-cercana',       'Testimonio de creador (UGC)',   300,   800,   1600),
  ('a-pie-de-calle',    'Entrevista en calle',           500,  1200,   2400),
  ('manos-a-la-obra',   'Demostración / tutorial',       450,  1100,   2200),
  ('el-descubrimiento', 'Unboxing / revelación',         350,   900,   1700),
  ('antes-y-despues',   'Transformación',                400,   950,   1900),
  ('susurro',           'ASMR sensorial',                300,   750,   1500),
  ('el-icono',          'Héroe de producto (CGI)',      2500,  8000,  14000),
  ('gran-pantalla',     'Spot cinematográfico',        12000, 45000, 120000),
  ('mundo-imposible',   'FOOH / surreal',              25000, 90000, 400000),
  ('imagen-social',     'Post para redes (still)',       120,   300,    600),
  ('imagen-banner',     'Banner / key visual',           900,  2200,   4500)
on conflict (asset_type) do nothing;

-- ============ 2. Retención de drafts ============
-- Un draft (tier fast) cuyo render final ya existe y tiene >7 días deja de
-- aportar: se elimina la fila (los archivos de storage quedan huérfanos,
-- mismo tradeoff que el cleanup V1 de failed/canceled).
create or replace function cleanup_old_data() returns jsonb as $$
declare
  v_gens_deleted bigint;
  v_refs_deleted bigint;
  v_notif_deleted bigint;
  v_drafts_purged bigint;
begin
  delete from generations
    where status in ('failed','canceled')
      and created_at < now() - interval '7 days';
  get diagnostics v_gens_deleted = row_count;

  delete from generations d
    where d.provider = 'seedance'
      and d.model_id like '%/fast/%'
      and d.status = 'done'
      and d.created_at < now() - interval '7 days'
      and exists (
        select 1 from generations f
        where f.parent_generation_id = d.id
          and f.status = 'done'
          and f.model_id not like '%/fast/%'
      );
  get diagnostics v_drafts_purged = row_count;

  delete from media_references
    where source = 'generation'
      and source_generation_id is null
      and created_at < now() - interval '24 hours';
  get diagnostics v_refs_deleted = row_count;

  delete from notifications
    where read_at is not null
      and created_at < now() - interval '30 days';
  get diagnostics v_notif_deleted = row_count;

  return jsonb_build_object(
    'generations_deleted', v_gens_deleted,
    'drafts_purged', v_drafts_purged,
    'references_deleted', v_refs_deleted,
    'notifications_deleted', v_notif_deleted
  );
end;
$$ language plpgsql security definer set search_path = public, pg_catalog;

revoke execute on function cleanup_old_data() from public, anon, authenticated;
