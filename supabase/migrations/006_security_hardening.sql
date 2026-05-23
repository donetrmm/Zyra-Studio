-- 006_security_hardening.sql
-- Cierra los advisors de seguridad detectados después de aplicar 001-005:
--
-- 1) function_search_path_mutable (WARN, x11): fija search_path explícito
--    para evitar search-path hijacking en funciones security definer.
--
-- 2) anon/authenticated_security_definer_function_executable (WARN, x18):
--    revoca EXECUTE en las funciones que NUNCA deberían ser callable como
--    RPC desde el browser. Distinguimos por categoría:
--
--    KEEP exposed a authenticated:
--      - is_admin, is_workspace_member        (las usa RLS — deben ser callable)
--      - approve_purchase, reject_purchase    (guard interno is_admin())
--      - admin_grant_credits                  (guard interno is_admin())
--
--    REVOKE de anon, authenticated, public:
--      - reserve_credits, confirm_credits, refund_credits
--           CRÍTICO: aceptan p_user_id sin validar = auth.uid(). Expuestas
--           permitirían drenar balance de otro usuario. Solo callable
--           server-side desde el worker con service_role (bypassa el revoke).
--      - handle_new_user, handle_new_workspace  (trigger functions; no RPC)
--      - touch_updated_at                       (trigger function; no RPC)

-- ============ 1. search_path fijo ============

alter function public.is_admin()                              set search_path = public, pg_catalog;
alter function public.is_workspace_member(uuid)               set search_path = public, pg_catalog;
alter function public.reserve_credits(uuid, bigint, uuid)     set search_path = public, pg_catalog;
alter function public.confirm_credits(uuid, bigint, uuid)     set search_path = public, pg_catalog;
alter function public.refund_credits(uuid, bigint, uuid)      set search_path = public, pg_catalog;
alter function public.approve_purchase(uuid)                  set search_path = public, pg_catalog;
alter function public.reject_purchase(uuid, text)             set search_path = public, pg_catalog;
alter function public.admin_grant_credits(uuid, bigint, text) set search_path = public, pg_catalog;
alter function public.handle_new_user()                       set search_path = public, pg_catalog;
alter function public.handle_new_workspace()                  set search_path = public, pg_catalog;
alter function public.touch_updated_at()                      set search_path = public, pg_catalog;

-- ============ 2. revoke EXECUTE de funciones no-RPC ============
-- Default-permissive: en Postgres, EXECUTE en funciones nuevas se otorga a
-- PUBLIC por default. Hay que revocar explícitamente de los 3 roles.

revoke execute on function public.reserve_credits(uuid, bigint, uuid)  from public, anon, authenticated;
revoke execute on function public.confirm_credits(uuid, bigint, uuid)  from public, anon, authenticated;
revoke execute on function public.refund_credits(uuid, bigint, uuid)   from public, anon, authenticated;
revoke execute on function public.handle_new_user()                     from public, anon, authenticated;
revoke execute on function public.handle_new_workspace()                from public, anon, authenticated;
revoke execute on function public.touch_updated_at()                    from public, anon, authenticated;

-- service_role tiene permisos de superuser-equivalent en Supabase y no se
-- ve afectado por los REVOKE de arriba. El worker (que es lo único que las
-- llama) usa service_role.
