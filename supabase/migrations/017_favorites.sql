-- 017_favorites.sql
-- Tabla de favoritos: un usuario puede marcar generaciones como favoritas.

create table if not exists favorites (
  user_id uuid not null references profiles(id) on delete cascade,
  generation_id uuid not null references generations(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, generation_id)
);

create index if not exists idx_fav_user on favorites(user_id, created_at desc);

alter table favorites enable row level security;

drop policy if exists "favorites_owner_read"   on favorites;
drop policy if exists "favorites_owner_insert" on favorites;
drop policy if exists "favorites_owner_delete" on favorites;

create policy "favorites_owner_read"   on favorites for select using (user_id = auth.uid());
create policy "favorites_owner_insert" on favorites for insert with check (user_id = auth.uid());
create policy "favorites_owner_delete" on favorites for delete using (user_id = auth.uid());
