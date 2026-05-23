-- 003_functions_and_triggers.sql
-- Funciones SQL atómicas para créditos + triggers de signup, workspace, updated_at.
-- Todas las funciones que tocan créditos/profiles/audit son `security definer`
-- y deben quedar owned por `postgres` (default si se ejecuta como service_role).

-- ============ CRÉDITOS ============

create or replace function reserve_credits(p_user_id uuid, p_amount bigint, p_generation_id uuid)
returns boolean as $$
declare
  v_balance bigint;
begin
  select balance into v_balance from credit_balances where user_id = p_user_id for update;

  if v_balance is null or v_balance < p_amount then
    return false;
  end if;

  update credit_balances
    set balance = balance - p_amount,
        pending = pending + p_amount,
        updated_at = now()
    where user_id = p_user_id;

  insert into credit_transactions(user_id, delta, reason, generation_id)
    values (p_user_id, -p_amount, 'generation_charge', p_generation_id);

  return true;
end;
$$ language plpgsql security definer;

create or replace function confirm_credits(p_user_id uuid, p_amount bigint, p_generation_id uuid)
returns void as $$
begin
  update credit_balances
    set pending = pending - p_amount, updated_at = now()
    where user_id = p_user_id;
end;
$$ language plpgsql security definer;

create or replace function refund_credits(p_user_id uuid, p_amount bigint, p_generation_id uuid)
returns void as $$
begin
  update credit_balances
    set balance = balance + p_amount,
        pending = pending - p_amount,
        updated_at = now()
    where user_id = p_user_id;

  insert into credit_transactions(user_id, delta, reason, generation_id)
    values (p_user_id, p_amount, 'generation_refund', p_generation_id);
end;
$$ language plpgsql security definer;

-- ============ COMPRAS ============

create or replace function approve_purchase(p_purchase_id uuid) returns void as $$
declare
  v_purchase credit_purchases%rowtype;
begin
  if not is_admin() then
    raise exception 'only admins can approve purchases';
  end if;

  select * into v_purchase from credit_purchases where id = p_purchase_id for update;
  if v_purchase is null or v_purchase.status <> 'pending' then
    raise exception 'purchase not found or not pending';
  end if;

  update credit_purchases
    set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = p_purchase_id;

  update credit_balances
    set balance = balance + v_purchase.credits, updated_at = now()
    where user_id = v_purchase.user_id;

  insert into credit_transactions(user_id, delta, reason, admin_id, metadata)
    values (v_purchase.user_id, v_purchase.credits, 'purchase_approved',
            auth.uid(), jsonb_build_object('pack_id', v_purchase.pack_id, 'purchase_id', p_purchase_id));

  insert into notifications(user_id, type, payload)
    values (v_purchase.user_id, 'purchase_approved',
            jsonb_build_object('credits', v_purchase.credits, 'pack_id', v_purchase.pack_id));

  insert into admin_audit_log(admin_id, action, target_user_id, target_resource_id, payload)
    values (auth.uid(), 'purchase_approve', v_purchase.user_id, p_purchase_id,
            jsonb_build_object('credits', v_purchase.credits));
end;
$$ language plpgsql security definer;

create or replace function reject_purchase(p_purchase_id uuid, p_reason text) returns void as $$
declare
  v_purchase credit_purchases%rowtype;
begin
  if not is_admin() then
    raise exception 'only admins can reject purchases';
  end if;

  select * into v_purchase from credit_purchases where id = p_purchase_id for update;
  if v_purchase is null or v_purchase.status <> 'pending' then
    raise exception 'purchase not found or not pending';
  end if;

  update credit_purchases
    set status = 'rejected', approved_by = auth.uid(), approved_at = now(), notes = p_reason
    where id = p_purchase_id;

  insert into notifications(user_id, type, payload)
    values (v_purchase.user_id, 'purchase_rejected',
            jsonb_build_object('pack_id', v_purchase.pack_id, 'reason', p_reason));

  insert into admin_audit_log(admin_id, action, target_user_id, target_resource_id, payload)
    values (auth.uid(), 'purchase_reject', v_purchase.user_id, p_purchase_id,
            jsonb_build_object('reason', p_reason));
end;
$$ language plpgsql security definer;

-- ============ AJUSTE MANUAL POR ADMIN ============

create or replace function admin_grant_credits(
  p_user_id uuid, p_delta bigint, p_reason text
) returns void as $$
declare
  v_current bigint;
begin
  if not is_admin() then
    raise exception 'only admins can adjust credits';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason is required';
  end if;

  select balance into v_current from credit_balances where user_id = p_user_id for update;
  if v_current is null then
    raise exception 'user has no balance row';
  end if;
  if v_current + p_delta < 0 then
    raise exception 'adjustment would leave negative balance';
  end if;

  update credit_balances
    set balance = balance + p_delta, updated_at = now()
    where user_id = p_user_id;

  insert into credit_transactions(user_id, delta, reason, admin_id, metadata)
    values (p_user_id, p_delta, 'admin_grant', auth.uid(),
            jsonb_build_object('note', p_reason));

  insert into notifications(user_id, type, payload)
    values (p_user_id, 'credit_grant',
            jsonb_build_object('delta', p_delta, 'reason', p_reason));

  insert into admin_audit_log(admin_id, action, target_user_id, payload)
    values (auth.uid(), 'credit_adjust', p_user_id,
            jsonb_build_object('delta', p_delta, 'reason', p_reason));
end;
$$ language plpgsql security definer;

-- ============ TRIGGERS DE SIGNUP / WORKSPACE ============

-- Crea profile + balance + signup_bonus al insertarse en auth.users.
-- Lee GUC `app.admin_emails` (coma-separados) para auto-asignar role='admin'.
create or replace function handle_new_user() returns trigger as $$
declare
  v_role text := 'user';
  v_admin_emails text := coalesce(current_setting('app.admin_emails', true), '');
  v_email text := coalesce(new.email, new.raw_user_meta_data->>'email');
begin
  if v_email is null then
    raise exception 'cannot create profile: user % has no email', new.id;
  end if;

  if v_admin_emails <> '' and v_email = any(string_to_array(v_admin_emails, ',')) then
    v_role := 'admin';
  end if;

  insert into profiles(id, email, role)
    values (new.id, v_email, v_role);

  insert into credit_balances(user_id, balance, pending)
    values (new.id, 500, 0);

  insert into credit_transactions(user_id, delta, reason, metadata)
    values (new.id, 500, 'signup_bonus', jsonb_build_object('source', 'auto'));

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Owner-as-member al crear workspace.
create or replace function handle_new_workspace() returns trigger as $$
begin
  insert into workspace_members(workspace_id, user_id, role)
    values (new.id, new.owner_id, 'owner')
    on conflict do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_workspace_created on workspaces;
create trigger on_workspace_created
  after insert on workspaces
  for each row execute function handle_new_workspace();

-- ============ TRIGGERS DE UPDATED_AT ============

create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_updated_at        on profiles;
drop trigger if exists trg_credit_balances_updated_at on credit_balances;
drop trigger if exists trg_model_pricing_updated_at   on model_pricing;
create trigger trg_profiles_updated_at        before update on profiles        for each row execute function touch_updated_at();
create trigger trg_credit_balances_updated_at before update on credit_balances for each row execute function touch_updated_at();
create trigger trg_model_pricing_updated_at   before update on model_pricing   for each row execute function touch_updated_at();
