# 20 — Equipos y colaboración (workspace compartido)

Estado: fase 1 implementada (2026-07-14).

## Problema

`workspace_members` existe desde la migración 001 (con roles owner/editor/
viewer y RLS member-based en todas las tablas), pero no había NINGUNA forma de
poblarlo: cero UI, cero invitaciones. Todo workspace era unipersonal.

## Decisiones (2026-07-14)

- **Créditos: cada miembro paga lo suyo.** El balance sigue siendo por usuario
  (`credit_balances.user_id`); un editor genera en el workspace compartido
  consumiendo su propio saldo. El pool por workspace (modelo agencia) queda
  para fase 2 — requiere migrar las 5 funciones SQL de dinero.
- **Invitación por LINK, no por email** (el alcance no incluye email
  transaccional): token de un solo uso, 7 días de expiración, el owner lo
  comparte por donde quiera. El token ES la autorización.
- **Solo rol `editor` en invitaciones.** `viewer` existe en el check de la
  tabla pero no se ofrece hasta que haya enforcement granular por rol en las
  server actions (hoy un viewer podría mutar — mentira peligrosa).

## Fase 1 (implementada)

- **Migración 068**: tabla `workspace_invites` (token unique, role, expires_at,
  used_by/used_at) con RLS owner-only; funciones `security definer`:
  - `peek_workspace_invite(token)` — vista previa para la página de canje
    ("Te invitaron a X como editor") sin exponer la tabla.
  - `redeem_workspace_invite(token)` — canje atómico (`for update` contra
    doble canje concurrente, `on conflict` para el que ya era miembro).
- **Migración 069**: policy `profiles_peer_read` — los miembros de un mismo
  workspace se leen nombre/email/avatar (la página de equipo no usa admin
  client; el service role queda para worker/admin/cleanup).
- **Workspace activo por cookie** (`active_workspace`): `getCurrentWorkspace`
  la respeta si el usuario es miembro y cae al primer workspace si no.
  `setActiveWorkspaceAction` valida membresía antes de setearla. El switcher
  vive en `/app/team` (aparece con 2+ membresías).
- **`/app/team`**: miembros con rol y avatar; owner además genera links
  (copiado al portapapeles), revoca invitaciones pendientes y quita miembros
  (nunca a sí mismo ni al owner). Lo creado por un miembro removido queda en
  el workspace (FKs apuntan al workspace).
- **`/app/join/[token]`**: peek + botón de canje; al unirse activa el
  workspace y redirige a `/app`.
- Entrada "Equipo" en el UserMenu.

## Fase 2 (pendiente)

- Rol `viewer` con enforcement real (guard por rol en server actions de
  mutación) — hasta entonces no se ofrece.
- Pool de créditos por workspace (decisión de negocio + migración de las
  funciones SQL atómicas).
- Switcher de workspace en el UserMenu/Topbar (hoy en /app/team).
- Límite de asientos por plan cuando exista pricing por plan.

## Notas de seguridad

- Server actions validan `workspace.role === 'owner'` Y la RLS owner-only es
  la segunda línea (patrón del repo).
- El canje exige sesión (`auth.uid()` en la función; anon sin grant).
- Cookies httpOnly + sameSite lax; el DAL re-valida la membresía en cada
  request — una cookie robada/stale no da acceso a un workspace ajeno.
