-- 009_prompt_enhance.sql
-- Agrega capacidad de cobrar créditos por operaciones internas sin generation_id,
-- empezando por "prompt_enhance" (Gemini Flash mejora el prompt del usuario).
--
-- Pricing: provider='internal', model_id='prompt-enhance', variant='default' = 5 cr.
-- (≈16% de una generación nano-flash 1K, que es el modelo más barato.)
--
-- Funciones charge_credits / refund_charge: análogas a reserve/refund de créditos
-- de generación, pero sin requerir generation_id. Solo service_role las invoca;
-- revoked de anon/authenticated para evitar drenar balance de otros usuarios
-- (mismo razonamiento que reserve/confirm/refund_credits en 006).

insert into model_pricing (provider, model_id, variant, credits_cost, unit_size, unit_label) values
  ('internal', 'prompt-enhance', 'default', 5, null, null)
on conflict (provider, model_id, variant) do nothing;

create or replace function charge_credits(
  p_user_id uuid,
  p_amount bigint,
  p_reason text,
  p_metadata jsonb default null
) returns boolean as $$
declare
  v_balance bigint;
begin
  select balance into v_balance from credit_balances where user_id = p_user_id for update;
  if v_balance is null or v_balance < p_amount then
    return false;
  end if;
  update credit_balances
    set balance = balance - p_amount, updated_at = now()
    where user_id = p_user_id;
  insert into credit_transactions(user_id, delta, reason, metadata)
    values (p_user_id, -p_amount, p_reason, coalesce(p_metadata, '{}'::jsonb));
  return true;
end;
$$ language plpgsql security definer set search_path = public, pg_catalog;

create or replace function refund_charge(
  p_user_id uuid,
  p_amount bigint,
  p_reason text,
  p_metadata jsonb default null
) returns void as $$
begin
  update credit_balances
    set balance = balance + p_amount, updated_at = now()
    where user_id = p_user_id;
  insert into credit_transactions(user_id, delta, reason, metadata)
    values (p_user_id, p_amount, p_reason, coalesce(p_metadata, '{}'::jsonb));
end;
$$ language plpgsql security definer set search_path = public, pg_catalog;

revoke execute on function charge_credits(uuid, bigint, text, jsonb) from public, anon, authenticated;
revoke execute on function refund_charge(uuid, bigint, text, jsonb)  from public, anon, authenticated;
