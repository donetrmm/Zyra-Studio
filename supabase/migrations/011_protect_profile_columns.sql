-- 011_protect_profile_columns.sql
-- Fix-forward de la 010: el `revoke update (role, status) on profiles from
-- anon, authenticated` NO surtió efecto porque Supabase otorga UPDATE
-- table-level a `authenticated` por default (grant en todo public.*). Cuando
-- existe el privilegio table-level, los REVOKE column-level son no-op
-- (Postgres no permite "negativo selectivo" — o tienes el privilegio o no).
--
-- Reemplazamos por un trigger BEFORE UPDATE que rechaza el cambio de role o
-- status cuando el caller no es admin. service_role bypasea via current_user
-- check (los triggers respetan el rol activo). Los triggers internos
-- (handle_new_user) corren como `postgres` y también bypasean.
--
-- También dropeamos los REVOKE column-level del 010 (que estaban OK pero son
-- ruido sin efecto).

create or replace function protect_profile_sensitive_columns() returns trigger as $$
begin
  -- Si nada sensible cambió, no validamos nada.
  if new.role is not distinct from old.role
     and new.status is not distinct from old.status then
    return new;
  end if;

  -- service_role y postgres (triggers internos como handle_new_user) bypasean.
  -- supabase_admin / supabase_auth_admin también, por si Supabase corre
  -- migraciones internas que tocan estas columnas.
  if current_user in ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin') then
    return new;
  end if;

  -- Para usuarios autenticados, solo admin puede mutar role/status.
  if is_admin() then
    return new;
  end if;

  raise exception 'forbidden: cannot modify profiles.role or profiles.status'
    using errcode = '42501';  -- insufficient_privilege
end;
$$ language plpgsql security definer set search_path = public, pg_catalog;

drop trigger if exists trg_profiles_protect_sensitive on profiles;
create trigger trg_profiles_protect_sensitive
  before update on profiles
  for each row execute function protect_profile_sensitive_columns();
