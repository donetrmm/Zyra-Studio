-- 012_protect_profile_columns_fix.sql
-- Fix de la 011: el trigger anterior tenía `security definer`, por lo que
-- `current_user` adentro siempre era el owner (postgres) y el guard
-- `current_user in ('postgres', ...)` bypaseaba SIEMPRE — incluyendo
-- llamadas desde authenticated.
--
-- Quitamos `security definer`. Sin SD, `current_user` dentro del trigger es
-- el rol que ejecutó el UPDATE (authenticated, anon, service_role, postgres),
-- y el guard funciona correctamente. `is_admin()` sigue siendo security
-- definer y puede leer profiles sin problemas.

create or replace function protect_profile_sensitive_columns() returns trigger as $$
begin
  if new.role is not distinct from old.role
     and new.status is not distinct from old.status then
    return new;
  end if;

  -- Roles de servicio bypasean — son los únicos que tienen razón legítima
  -- para mutar role/status (signup trigger via postgres, admin tools via
  -- service_role, supabase auth via supabase_auth_admin).
  if current_user in ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin') then
    return new;
  end if;

  -- Admin autenticado: permitido (vía RPC admin_grant_credits, futuros
  -- adminActions de banneo, etc.).
  if is_admin() then
    return new;
  end if;

  raise exception 'forbidden: cannot modify profiles.role or profiles.status'
    using errcode = '42501';
end;
$$ language plpgsql set search_path = public, pg_catalog;
-- NO security definer.

drop trigger if exists trg_profiles_protect_sensitive on profiles;
create trigger trg_profiles_protect_sensitive
  before update on profiles
  for each row execute function protect_profile_sensitive_columns();
