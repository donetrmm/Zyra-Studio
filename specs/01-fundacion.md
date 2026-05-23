# Fase 1 — Fundación

> **Día 1–2 · ~20 horas · ~28% del proyecto**
>
> Deja la infraestructura, el schema, la auth y el chasis de la app listos para que las fases 2–5 solo agreguen features sobre algo sólido.

## Pre-requisitos

- Cuentas creadas: Vercel, Supabase, Upstash, Google AI Studio (Gemini), klingapi.com, bfl.ai, elevenlabs.io.
- Dominio o subdominio Vercel apuntado (`NEXT_PUBLIC_APP_URL`).
- Tener decidido el correo del admin inicial (irá en `app.admin_emails`).

## Objetivo

Al cerrar la fase, un usuario puede:
1. Registrarse con Google o email.
2. Completar onboarding (nombre del workspace + área).
3. Aterrizar en `/app` con sidebar, topbar y créditos de bienvenida (500) visibles.
4. Si su email está en `app.admin_emails`, ver el panel `/admin` con la tabla de usuarios y poder ajustar créditos manualmente.

No se genera nada todavía — solo el esqueleto y la auth/identidad.

## Tareas en orden

### 1. Bootstrap del repo (1.5h)

- `pnpm create next-app@latest zyra-studio --typescript --tailwind --app --src-dir=false --import-alias='@/*'` (Next 15, App Router).
- Instalar dependencias base: `@supabase/supabase-js`, `@supabase/ssr`, `zustand`, `react-hook-form`, `zod`, `@hookform/resolvers`, `@upstash/qstash`, `lucide-react`, `clsx`, `tailwind-merge`.
- Instalar shadcn: `pnpm dlx shadcn@latest init` (base zinc, dark mode, CSS variables).
- Configurar `next.config.ts` con `images.remotePatterns` para Supabase Storage.
- Configurar fonts: Inter (UI) + Geist (display).
- Variables de entorno: copiar `.env.local` desde el template de la sección 16 del spec; setear todas excepto las de proveedores externos (esas en fase 2–3).

### 2. Proyecto Supabase (1h)

- Crear proyecto en Supabase (region más cercana, plan Free).
- Habilitar Google OAuth (provider) con credenciales OAuth de Google Cloud.
- Configurar la URL de redirect: `https://<dominio>/auth/callback`.
- Setear el GUC para admins:
  ```sql
  alter database postgres set app.admin_emails = 'tu@correo.com';
  ```
- Crear los 6 buckets de Storage (`outputs`, `references`, `voice-samples`, `thumbnails`, `avatars`, `brand-assets`) con la visibilidad correcta según sección 4 del spec.
- Configurar CORS en `references`, `voice-samples`, `avatars`: orígenes permitidos = dominio Vercel + `http://localhost:3000`.

### 3. Migraciones (3h)

Crear `supabase/migrations/` y ejecutar en orden estricto:

- `001_initial_schema.sql` — todas las tablas de la sección 4 del spec (profiles → admin_audit_log). Verificar el orden: brand_kits/characters/voice_clones antes de generations.
- `002_rls_policies.sql` — `alter table ... enable rls` + funciones helper (`is_admin`, `is_workspace_member`) + todas las policies.
- `003_functions_and_triggers.sql` — `reserve_credits`, `confirm_credits`, `refund_credits`, `approve_purchase`, `reject_purchase`, `admin_grant_credits`, `handle_new_user`, `handle_new_workspace`, `touch_updated_at` + los triggers.
- `004_realtime.sql` — `alter publication supabase_realtime add table generations, credit_balances, notifications;`
- `005_seed_pricing.sql` — INSERT de todas las filas de `model_pricing` según sección 5 (video, imagen, audio).

Aplicar con `supabase db push` o desde el SQL Editor del dashboard.

### 4. Cliente Supabase (1.5h)

- `lib/supabase/client.ts` — `createBrowserClient` para componentes cliente.
- `lib/supabase/server.ts` — `createServerClient` con cookies para RSC y server actions.
- `lib/supabase/middleware.ts` — refresh de sesión.
- `lib/supabase/admin.ts` — service role client para worker y operaciones admin.

### 5. Auth + middleware (2h)

- `/login` y `/signup` con formularios shadcn (email/password + botón "Continuar con Google").
- `/auth/callback/route.ts` — intercambia el code por sesión.
- `middleware.ts` raíz: protege `/app/*` y `/admin/*`. Si no hay sesión → `/login`. Si está logueado pero no tiene workspace → `/onboarding`. Si `/admin/*` y `profile.role != 'admin'` → 404.
- Logout server action.

### 6. Onboarding (1.5h)

- `/onboarding` página con 3 pasos (Stepper de shadcn):
  - Paso 1: nombre del workspace (input).
  - Paso 2: área (select: marketing, agencia, freelance, e-commerce, startup, empresa SaaS, otro). Guarda en `profiles.area`.
  - Paso 3: confirmación del bono de 500 créditos + botón "Empezar".
- Server action `completeOnboarding(workspaceName, area)`:
  - Update `profiles.area`.
  - Insert en `workspaces` (el trigger `handle_new_workspace` mete al owner como miembro).
  - Redirect a `/app`.

### 7. Layout principal (2.5h)

- `app/app/layout.tsx`: sidebar (240px) + topbar + main.
- `components/layout/Sidebar.tsx`: navegación con items de la sección 8 del spec, ítem activo destacado.
- `components/layout/Topbar.tsx`:
  - Workspace switcher (dropdown si el usuario es miembro de >1).
  - Credit pill: muestra balance, suscrito a `credit_balances` vía Realtime.
  - Notification badge: suscrito a `notifications where read_at is null`.
  - User menu (avatar, settings, logout).
- `components/layout/MobileBottomNav.tsx`: bottom-nav con 5 items principales.
- Dark mode por defecto, toggle en user menu.

### 8. Dashboard `/app` (1.5h)

- Página vacía pero funcional: cards con "Tus campañas recientes" (vacío con CTA "Crear campaña"), "Generaciones recientes" (vacío con CTA "Empezar a crear"), métrica del balance.
- Server Component que lee de Supabase con el server client.

### 9. Panel admin esqueleto (3h)

- `/admin/layout.tsx`: verifica `role='admin'` (ya cubierto por middleware pero double-check en server).
- `/admin/page.tsx`: dashboard con cards de métricas (queries SQL):
  - Total de usuarios, activos 7d/30d.
  - Sum de créditos consumidos vs cargados.
  - Top 10 por consumo.
- `/admin/users/page.tsx`: tabla paginada (TanStack Table o data-table de shadcn) con filtros básicos.
- Diálogo "Ajustar créditos": llama `admin_grant_credits(user_id, delta, reason)`. Validación zod (delta no-cero, razón obligatoria ≥ 3 chars).
- `/admin/audit/page.tsx`: tabla read-only paginada de `admin_audit_log`.

### 10. Notificaciones in-app (1h)

- `components/layout/NotificationDropdown.tsx`: lista de no-leídas, click para marcar como leída (UPDATE `read_at = now()`).
- Suscripción Realtime al canal `notifications` filtrado por `user_id = me`.

### 11. Smoke test (1.5h)

Manualmente:
- Signup con email nuevo → llega a onboarding → workspace creado → topbar muestra 500 créditos.
- Signup con un email en `app.admin_emails` → mismo flujo + sidebar muestra `/admin`.
- Desde `/admin/users` ajustar +1000 créditos a un user normal → ese user ve el balance subir en vivo + recibe notificación.
- Logout → /login → relogin recupera el workspace.

## Criterios de aceptación

- [ ] Migraciones corren sin error sobre una DB Supabase limpia, en orden, sin warnings de FK ni de RLS.
- [ ] `select count(*) from model_pricing` devuelve ≥ 22 filas (todos los modelos del seed).
- [ ] Trigger de signup crea profile + balance + transacción. Verificable con un signup y consulta a las 3 tablas.
- [ ] Owner de workspace puede leerlo (RLS pasa). Un user que no es miembro no ve el workspace.
- [ ] Realtime entrega un evento de `credit_balances` al navegador del usuario cuyo balance fue ajustado por admin.
- [ ] Middleware redirige correctamente: sin sesión → login, sin workspace → onboarding, no admin en `/admin` → 404.

## Lo que NO entra en esta fase

- Cualquier endpoint que llame a un proveedor externo (Gemini, Kling, BFL, ElevenLabs).
- `/api/jobs/process` y `/api/jobs/cleanup` (fases 3 y 5).
- Cualquier `/app/create/*` (fase 2 y 3).
- Brand kits, characters, voice clones, storyboard, presets (fase 4).
- Compras simbólicas (fase 2).

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Trigger `handle_new_user` falla y el primer signup queda sin profile | Probar el trigger con un INSERT directo a `auth.users` desde SQL Editor antes del primer signup real |
| GUC `app.admin_emails` no se propaga por pgbouncer | Si el primer signup admin queda como `user`, ejecutar el fallback `update profiles set role='admin' ...` manualmente y reiniciar la base desde Dashboard |
| RLS bloquea queries que deberían pasar | Probar cada policy con `select set_config('request.jwt.claim.sub', '<uuid>', false);` en SQL Editor antes de seguir |
| Google OAuth redirect mal configurado | Probar primero email/password (más simple), agregar Google al final con tiempo de iterar |
