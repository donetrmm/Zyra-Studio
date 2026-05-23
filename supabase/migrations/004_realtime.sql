-- 004_realtime.sql
-- Agrega tablas a la publication `supabase_realtime` para que el cliente reciba
-- events de cambio. Wrapeado en DO blocks: `alter publication ... add table`
-- falla si la tabla ya está en la publication; capturamos el duplicate_object
-- para que la migración sea re-runneable.

do $$
begin
  alter publication supabase_realtime add table generations;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table credit_balances;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table notifications;
exception when duplicate_object then null;
end $$;
