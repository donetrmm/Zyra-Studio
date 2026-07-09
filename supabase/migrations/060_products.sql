-- 060_products.sql
-- V3 Fase 1: entidad products (multi-producto por campaña). Hoy el producto vive
-- partido (imágenes en brand_kits.product_image_ids, ficha en campaigns.product_brief).
-- products lo junta como entidad workspace-level bajo una marca. Backfill: un
-- product por campaña existente, enlazado a sus items. No rompe: el orchestrator
-- cae a product_brief cuando el item no trae product_id.

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid references brand_kits(id) on delete set null,   -- null = sin marca (without-brand)
  name text not null,
  slug text,                                                    -- referencia estable para el matcher (los LLM citan slugs, no UUIDs)
  medium text,
  height_cm numeric,
  width_cm numeric,
  thickness_mm numeric,
  weight_kg numeric,
  visual_details text,
  palette jsonb,
  product_image_ids uuid[] not null default '{}',
  packaging_image_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_workspace_id_idx on products(workspace_id);
create index if not exists products_brand_id_idx on products(brand_id);

alter table products enable row level security;
drop policy if exists "products_read" on products;
create policy "products_read" on products for select
  using (is_workspace_member(workspace_id) or is_admin());
drop policy if exists "products_insert" on products;
create policy "products_insert" on products for insert
  with check (is_workspace_member(workspace_id));
drop policy if exists "products_update" on products;
create policy "products_update" on products for update
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists "products_delete" on products;
create policy "products_delete" on products for delete
  using (is_workspace_member(workspace_id));

drop trigger if exists products_touch_updated_at on products;
create trigger products_touch_updated_at before update on products
  for each row execute function touch_updated_at();

-- Pool de productos por campaña (join). Sin workspace_id: RLS via la campaña.
create table if not exists campaign_products (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (campaign_id, product_id)
);
create index if not exists campaign_products_product_id_idx on campaign_products(product_id);

alter table campaign_products enable row level security;
drop policy if exists "campaign_products_read" on campaign_products;
create policy "campaign_products_read" on campaign_products for select
  using (exists (select 1 from campaigns c where c.id = campaign_id
    and (is_workspace_member(c.workspace_id) or is_admin())));
drop policy if exists "campaign_products_insert" on campaign_products;
create policy "campaign_products_insert" on campaign_products for insert
  with check (exists (select 1 from campaigns c where c.id = campaign_id
    and is_workspace_member(c.workspace_id)));
drop policy if exists "campaign_products_delete" on campaign_products;
create policy "campaign_products_delete" on campaign_products for delete
  using (exists (select 1 from campaigns c where c.id = campaign_id
    and is_workspace_member(c.workspace_id)));

-- Producto por clip + prioridad de referencias por clip.
alter table campaign_items
  add column if not exists product_id uuid references products(id) on delete set null,
  add column if not exists reference_selection jsonb;

-- Backfill: un product por campaña "studio" (product_brief no nulo; los folders de
-- colección lo tienen null). Idempotente: solo si la campaña aún no tiene product.
do $$
declare r record; pid uuid;
begin
  for r in
    select c.id as campaign_id, c.workspace_id, c.brand_kit_id, c.product_brief,
           bk.product_image_ids as bk_product_ids, bk.packaging_image_ids as bk_pkg_ids
    from campaigns c
    left join brand_kits bk on bk.id = c.brand_kit_id
    where c.product_brief is not null
      and not exists (select 1 from campaign_products cp where cp.campaign_id = c.id)
  loop
    insert into products (
      workspace_id, brand_id, name, slug, medium,
      height_cm, width_cm, thickness_mm, weight_kg,
      visual_details, palette, product_image_ids, packaging_image_ids)
    values (
      r.workspace_id, r.brand_kit_id,
      coalesce(nullif(r.product_brief->>'productName',''), 'Producto'),
      lower(regexp_replace(coalesce(r.product_brief->>'productName','producto'), '[^a-zA-Z0-9]+', '-', 'g')),
      r.product_brief->>'medium',
      (r.product_brief->>'heightCm')::numeric,
      (r.product_brief->>'widthCm')::numeric,
      (r.product_brief->>'thicknessMm')::numeric,
      (r.product_brief->>'weightKg')::numeric,
      r.product_brief->>'visualDetails',
      case when r.product_brief ? 'palette' then r.product_brief->'palette' else null end,
      coalesce(r.bk_product_ids, '{}'), coalesce(r.bk_pkg_ids, '{}'))
    returning id into pid;

    insert into campaign_products (campaign_id, product_id) values (r.campaign_id, pid);
    update campaign_items set product_id = pid
      where campaign_id = r.campaign_id and product_id is null;
    update campaign_items ci set reference_selection = c.reference_selection
      from campaigns c
      where c.id = r.campaign_id and ci.campaign_id = r.campaign_id
        and c.reference_selection is not null and ci.reference_selection is null;
  end loop;
end $$;
