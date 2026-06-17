-- 040_notify_generation_done.sql
-- Notifica "tu generacion esta lista" cuando una generacion MANUAL (sin
-- campaign_id) llega a 'done'. Las generaciones de campana tienen su propia UI
-- en vivo (Producción con Realtime) y notificar cada clip de un lote seria
-- ruido, asi que se excluyen. El frontend ya maneja el tipo 'generation_done'
-- (components/layout/NotificationBell.tsx); aqui solo faltaba el disparador.

create or replace function notify_generation_done() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done'
     and old.status is distinct from new.status
     and new.campaign_id is null then
    insert into public.notifications(user_id, type, payload)
      values (new.user_id, 'generation_done',
              jsonb_build_object('generation_id', new.id, 'type', new.type));
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_generation_done on generations;
create trigger trg_notify_generation_done
  after update of status on generations
  for each row execute function notify_generation_done();
