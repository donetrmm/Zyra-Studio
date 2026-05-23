# Smoke test — Fase 1

Checklist manual para validar la fundación una vez que Supabase está provisionado y las migraciones aplicadas. Requiere haber completado [`docs/setup/supabase.md`](./supabase.md) y haber poblado `.env.local`.

## 0. Pre-vuelo

- [ ] `pnpm install` corre sin errores.
- [ ] `pnpm typecheck` pasa.
- [ ] `pnpm build` pasa.
- [ ] En `.env.local` están seteados `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y `NEXT_PUBLIC_APP_URL`.
- [ ] En Supabase SQL Editor: `select count(*) from model_pricing;` devuelve 27.
- [ ] `select tablename from pg_tables where schemaname='public' and rowsecurity=true;` lista 19 tablas con RLS habilitada.

Arranca: `pnpm dev` → http://localhost:3000.

## 1. Landing y rutas públicas

- [ ] `/` muestra "Create Beyond Limits" con CTAs "Empezar gratis" y "Iniciar sesión".
- [ ] `/login` muestra el card con email + password + botón Google.
- [ ] `/signup` muestra el card con nombre + email + password + botón Google.

## 2. Signup admin (vía GUC)

Requisito previo:

```sql
alter database postgres set app.admin_emails = 'iskanderramos8@gmail.com';
-- Dashboard → Settings → Database → Restart server (o esperar al pool).
```

- [ ] Desde `/signup` registra `iskanderramos8@gmail.com` con password ≥ 8 chars.
- [ ] Redirige a `/onboarding`.
- [ ] El stepper muestra el paso 1 (nombre del workspace).
- [ ] Completa workspace name → paso 2 (área) → paso 3 (confirmación) → "Empezar".
- [ ] Aterrizas en `/app`.

Verificación SQL paralela:

```sql
select role, status, area from profiles where email = 'iskanderramos8@gmail.com';
-- → admin / active / <área que elegiste>

select balance, pending from credit_balances
  where user_id = (select id from profiles where email = 'iskanderramos8@gmail.com');
-- → 500 / 0

select count(*) from workspace_members
  where user_id = (select id from profiles where email = 'iskanderramos8@gmail.com');
-- → 1 (trigger handle_new_workspace metió al owner)

select reason from credit_transactions
  where user_id = (select id from profiles where email = 'iskanderramos8@gmail.com');
-- → signup_bonus
```

UI:

- [ ] Topbar muestra el nombre del workspace y `500 créditos`.
- [ ] User menu (avatar arriba a la derecha) muestra el email y la opción **Panel admin**.
- [ ] La sidebar a la izquierda lista las secciones (Crear / Trabajo / Recursos / Cuenta).

## 3. Signup user normal

En navegador privado o desde otro browser:

- [ ] Registra `usuario-prueba@example.com`.
- [ ] Pasa el onboarding y aterriza en `/app`.
- [ ] El user menu **NO** muestra Panel admin.
- [ ] Topbar muestra `500 créditos`.
- [ ] Visitar `/admin` directamente devuelve `404`.

## 4. Ajuste de créditos en vivo (Realtime)

Con la sesión del usuario normal abierta en una pestaña, abre otra pestaña con la sesión admin:

- [ ] En la sesión admin, ir a `/admin/users`.
- [ ] La tabla lista al usuario normal con balance 500.
- [ ] Click en **Ajustar créditos** → dialog.
- [ ] Ingresa `+1000` y razón `Bono de prueba`.
- [ ] **Aplicar** → toast verde.
- [ ] En la pestaña del usuario normal, la pill de créditos del topbar pasa de `500` a `1,500` **sin recargar**.
- [ ] El bell de notificaciones del usuario marca el punto rojo y al abrir muestra "Recibiste créditos".
- [ ] El **Marcar como leídas** vacía la lista.

Verificación SQL:

```sql
select delta, reason from credit_transactions
  where user_id = (select id from profiles where email = 'usuario-prueba@example.com')
  order by created_at desc limit 5;
-- → admin_grant +1000, signup_bonus +500

select action, payload from admin_audit_log order by created_at desc limit 1;
-- → credit_adjust, {delta: 1000, reason: "Bono de prueba"}
```

## 5. Auditoría admin

- [ ] `/admin/audit` muestra la fila del ajuste recién hecho.
- [ ] La columna **Admin** muestra el email admin, **Target** el email del user normal, **Acción** `credit_adjust`.

## 6. Resiliencia de session

- [ ] Desde el user menu del admin → **Cerrar sesión**.
- [ ] Redirige a `/login`.
- [ ] Volver a entrar con admin → aterriza en `/app` con el workspace cargado.
- [ ] Refresh `/admin/users` → la sesión sigue válida, tabla carga.

## 7. Edge cases

- [ ] Intentar `/login` o `/signup` ya logueado → redirige a `/app`.
- [ ] Intentar `/app` sin sesión (clear cookies) → redirige a `/login?next=/app`.
- [ ] Login fallido (password incorrecto) → muestra "Credenciales inválidas".
- [ ] Onboarding con workspace name < 2 chars → input se queda deshabilitado.

## Criterios de aceptación de Fase 1

| Criterio | Estado |
|---|---|
| Migraciones corren sin error en orden | ⬜ |
| `model_pricing` tiene 27 filas | ⬜ |
| Trigger de signup crea profile + balance + transacción | ⬜ |
| Owner ve su workspace via RLS; no miembro no | ⬜ |
| Realtime entrega evento de `credit_balances` al ajustar | ⬜ |
| Proxy redirige correctamente (sin sesión / sin workspace / no admin) | ⬜ |

Cuando todos estén checked, Fase 1 está cerrada y se puede empezar Fase 2.
