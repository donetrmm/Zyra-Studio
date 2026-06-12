# Zyra Studio — Especificación Técnica

> Plataforma creativa impulsada por IA para generar video, imagen y voz de manera rápida, moderna y profesional.
>
> **Alcance:** proyecto de desarrollo y deploy para presentación. No sale a producción.

---

## 1. Visión y alcance

Zyra Studio es un **studio creativo** (no un simple wrapper de modelos): los usuarios describen lo que necesitan y obtienen entregables organizados por campañas/proyectos, con control de costos vía créditos, referencias reutilizables y post-producción ligera.

**Diferenciadores clave:**
- Selector de modelo inteligente con router automático según el caso de uso
- Cast de personajes consistentes (multi-referencia)
- Brand Kit que se inyecta en prompts y generaciones
- Storyboard mode (planear secuencias antes de generar)
- Timeline editor ligero para combinar video + voz + música
- Panel admin completo (sin Stripe — compra simbólica en MXN)

---

## 2. Stack técnico

```
Frontend:    Next.js 15 (App Router) + React Server Components
UI:          shadcn/ui + Tailwind + Radix
Estado:      Zustand (cliente) + RSC (servidor)
Forms:       react-hook-form + zod
Backend:     Supabase (Auth + Postgres + Storage + Realtime) — plan free
Cola jobs:   Upstash QStash — free tier
Deploy:      Vercel — plan Hobby
```

### Proveedores de IA

| Tipo | Proveedor | Modelos |
|---|---|---|
| Video premium | Gemini API | `veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`, `veo-3.1-lite-generate-preview` |
| Video volumen | klingapi.com | `kling-video-o1`, `kling-3-0-omni`, `kling-v2.6-pro`, `kling-v2.6-std`, `kling-v2.5-turbo` |
| Imagen general | Gemini API | `gemini-3-pro-image-preview` (Nano Banana Pro), `gemini-3.1-flash-image-preview` |
| Imagen fotorrealista | api.bfl.ai | `flux-2-pro-preview` |
| Audio (todo) | api.elevenlabs.io | `eleven_v3`, `eleven_multilingual_v2`, `eleven_flash_v2_5` |

---

## 3. Arquitectura

```
┌──────────────────────────────────────────────────────┐
│  Next.js 15 — App Router + RSC                       │
│  - Pages: marketing, auth, app, admin                │
│  - Server Actions para mutaciones                     │
│  - API route /api/jobs/process (worker QStash)        │
└──────────────────────────────────────────────────────┘
          │
          ├──► Supabase (plan free)
          │    - Auth (Google OAuth + email/password)
          │    - Postgres con RLS básico
          │    - Storage buckets: outputs, references, voice-samples
          │    - Realtime (suscripción a cambios de status)
          │
          ├──► Cola de jobs (Upstash QStash free)
          │    - Worker en /api/jobs/process
          │    - Polling recursivo: el worker se re-encola cada 2–10s
          │    - SIN webhooks (polling siempre — más simple para demo)
          │
          └──► Proveedores externos
               - Gemini API (Veo + Nano Banana)
               - klingapi.com
               - api.bfl.ai
               - api.elevenlabs.io
```

### Patrón crítico: URLs efímeras

| Proveedor | TTL del output | Estrategia |
|---|---|---|
| FLUX 2 Pro | 10 min | Descarga inmediata tras completion |
| Kling 3.0 | 24 h | Descarga inmediata |
| Veo 3.1 | 2 días | Descarga inmediata |
| ElevenLabs | Stream | Captura del stream |

**El worker SIEMPRE descarga el output del proveedor, lo sube a Supabase Storage, genera thumbnail y luego actualiza `generations.output_url` con la URL interna. El usuario nunca recibe la URL del proveedor.**

### Por qué cola de jobs (obligatorio, no opcional)

- Vercel Hobby tiene **timeout máximo de 60s** en funciones serverless
- Veo tarda hasta 6 min, Kling Pro ~60s, FLUX variable
- Ninguna generación puede correr síncrona en una función Vercel
- QStash dispara HTTP al endpoint y el worker se re-encola a sí mismo hasta completar

---

## 4. Modelo de datos (Postgres / Supabase)

```sql
-- ============ IDENTIDAD ============
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  avatar_url text,
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  area text, -- vertical/industria capturada en onboarding (marketing, agencia, freelance, etc.)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table credit_balances (
  user_id uuid primary key references profiles(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  pending bigint not null default 0 check (pending >= 0),
  updated_at timestamptz default now()
);

create table credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  delta bigint not null,
  reason text not null, -- 'generation_charge', 'generation_refund', 'admin_grant', 'purchase_approved', 'signup_bonus'
  generation_id uuid,
  admin_id uuid references profiles(id),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index idx_credit_tx_user on credit_transactions(user_id, created_at desc);

-- ============ ORGANIZACIÓN ============
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  name text not null,
  created_at timestamptz default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz default now(),
  primary key (workspace_id, user_id)
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  color text default '#7c3aed',
  cover_url text,
  -- character_ids: pool de personajes de la campaña (máx 3 — validado en server action).
  -- Orden significativo: el primero es el principal. Sin FK a array; validar en app.
  -- Agregado en migración 031.
  character_ids uuid[] not null default '{}',
  created_at timestamptz default now()
);

-- campaign_items.character_ids (migración 031): personajes del creativo (máx 3).
-- Orden = orden de referencias en el prompt. character_id (columna existente) = principal,
-- sincronizado con character_ids[1] por todas las server actions que escriben campaign_items
-- (generatePlan, update, add, series, refinado); es lo que consumen las funciones mono-personaje.

create table projects (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name text not null,
  brief text,
  status text default 'draft' check (status in ('draft', 'in_progress', 'done', 'archived')),
  created_at timestamptz default now()
);

-- ============ ASSETS REUTILIZABLES (deben existir antes de generations
-- porque generations.brand_kit_id es FK) ============
create table brand_kits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  colors jsonb default '[]'::jsonb,  -- [{name, hex}]
  fonts jsonb default '[]'::jsonb,
  logo_url text,
  tone_description text,
  style_guidelines text,
  reference_image_ids uuid[] default array[]::uuid[],
  created_at timestamptz default now()
);

create table characters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  reference_image_ids uuid[] not null default array[]::uuid[],
  created_at timestamptz default now()
);

create table voice_clones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  workspace_id uuid references workspaces(id),
  name text not null,
  description text,
  elevenlabs_voice_id text unique,
  sample_storage_url text,
  status text default 'pending' check (status in ('pending', 'ready', 'failed')),
  created_at timestamptz default now()
);

-- ============ GENERACIONES ============
create table generations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  user_id uuid not null references profiles(id),
  workspace_id uuid not null references workspaces(id),

  type text not null check (type in ('video', 'image', 'audio')),
  provider text not null check (provider in ('veo', 'kling', 'nano-banana', 'flux', 'elevenlabs')),
  model_id text not null,

  prompt text,
  negative_prompt text,
  params jsonb not null default '{}'::jsonb,
  reference_ids uuid[] default array[]::uuid[],
  -- Trazabilidad: qué brand kit / personajes se usaron al generar (para
  -- auditoría, reproducción y para que el árbol de iteraciones sea útil).
  -- `character_ids` no es FK (Postgres no soporta FK a elementos de array);
  -- validar a nivel de aplicación.
  brand_kit_id uuid references brand_kits(id) on delete set null,
  character_ids uuid[] default array[]::uuid[],

  status text not null default 'queued' check (status in ('queued', 'processing', 'done', 'failed', 'canceled')),
  provider_task_id text,
  provider_payload jsonb, -- shape: {request: {...}, last_poll: {...}, completed: {...}}
  error_message text,
  -- Control de polling para no quemar QStash si el proveedor se cuelga:
  poll_attempts integer not null default 0,
  timeout_at timestamptz, -- vence => marcar 'failed' y refund en el siguiente poll
  cancel_requested boolean not null default false, -- bandera para que el worker corte

  output_url text,
  thumbnail_url text,
  duration_seconds numeric,
  file_size_bytes bigint,

  credits_estimated bigint not null,
  credits_charged bigint,
  processing_ms integer, -- now() - created_at al completar (tiempo total en cola + ejecución)

  parent_generation_id uuid references generations(id) on delete set null,
  -- Agrupa generaciones hermanas creadas por una misma acción de lote
  -- (storyboard, auto-variaciones, smart crop multi-formato). Permite que la
  -- UI las muestre como un solo bloque y sume costos/progreso.
  batch_id uuid,
  batch_kind text check (batch_kind in ('storyboard', 'variations', 'smart_crop', 'lipsync_pipeline')),

  created_at timestamptz default now(),
  completed_at timestamptz
);

create index idx_gen_user on generations(user_id, created_at desc);
create index idx_gen_project on generations(project_id);
create index idx_gen_status on generations(status) where status in ('queued', 'processing');
create index idx_gen_parent on generations(parent_generation_id);
create index idx_gen_batch on generations(batch_id) where batch_id is not null;

-- ============ REFERENCIAS Y ASSETS ============
-- Nota: el nombre `references` es palabra reservada en PostgreSQL, por eso
-- usamos `media_references`. Todas las FKs (`reference_ids`, `reference_image_ids`)
-- apuntan a esta tabla.
create table media_references (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id),
  type text not null check (type in ('image', 'audio', 'video')),
  storage_url text not null,
  thumbnail_url text,
  name text,
  tags text[] default array[]::text[],
  notes text,
  source text default 'upload' check (source in ('upload', 'generation')),
  -- on delete set null: el cleanup borra generations viejas; sus referencias
  -- en la library siguen accesibles pero pierden el link al original (lo cual
  -- el cleanup detecta vía source='generation' + source_generation_id is null
  -- para purgar después).
  source_generation_id uuid references generations(id) on delete set null,
  created_at timestamptz default now()
);

create table collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create table collection_items (
  collection_id uuid not null references collections(id) on delete cascade,
  generation_id uuid not null references generations(id) on delete cascade,
  added_at timestamptz default now(),
  primary key (collection_id, generation_id)
);

-- ============ PRESETS ============
create table presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  type text not null check (type in ('video', 'image', 'audio')),
  name text not null,
  description text,
  params jsonb not null,
  is_public boolean default false,
  uses_count integer default 0,
  created_at timestamptz default now()
);

-- ============ COMPRAS SIMBÓLICAS (sin Stripe) ============
-- pack_id, credits y price_mxn deben coincidir con el catálogo de la
-- sección 10. Validamos con CHECK constraint para que el usuario no pueda
-- crear una compra "Studio" pagando $1 (la insert policy ya restringe
-- user_id = auth.uid(), pero los demás campos los manda el cliente).
create table credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  pack_id text not null check (pack_id in ('starter','creator','pro','studio')),
  credits bigint not null,
  price_mxn numeric(10,2) not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  constraint pack_catalog_match check (
    -- catálogo actual
    (pack_id = 'starter' and credits =    500 and price_mxn =   49) or
    (pack_id = 'creator' and credits =   2000 and price_mxn =  179) or
    (pack_id = 'pro'     and credits =   5000 and price_mxn =  399) or
    (pack_id = 'studio'  and credits =  15000 and price_mxn =  999) or
    -- catálogo legacy (preserva filas históricas; ver 018_pack_catalog_rebalance.sql)
    (pack_id = 'starter' and credits =   2000 and price_mxn =   99) or
    (pack_id = 'creator' and credits =  10000 and price_mxn =  399) or
    (pack_id = 'pro'     and credits =  50000 and price_mxn = 1499) or
    (pack_id = 'studio'  and credits = 200000 and price_mxn = 4999)
  )
);

-- ============ PRECIOS DE MODELOS (editable desde admin) ============
create table model_pricing (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model_id text not null,
  -- NUNCA usar NULL aquí: PG trata NULLs como distintos en UNIQUE y permite
  -- duplicados. Usar 'default' cuando no aplique una variante.
  variant text not null default 'default', -- e.g. '1080p_8s', '4k_8s', '1k', '2k', '4k'
  credits_cost bigint not null,
  -- Para precios proporcionales (ElevenLabs TTS por 1000 chars, FLUX por MP):
  -- el estimador hace `ceil(units / unit_size) * credits_cost`. Si null, costo fijo.
  unit_size integer,
  unit_label text, -- 'chars', 'mp', 'seconds' (informativo)
  is_active boolean default true,
  updated_at timestamptz default now(),
  updated_by uuid references profiles(id),
  unique(provider, model_id, variant)
);

-- ============ NOTIFICACIONES IN-APP ============
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null, -- 'purchase_approved', 'purchase_rejected', 'generation_done', 'credit_grant', etc.
  payload jsonb default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz default now()
);

create index idx_notif_user_unread on notifications(user_id, created_at desc) where read_at is null;

-- ============ AUDITORÍA ADMIN ============
create table admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references profiles(id),
  action text not null,
  target_user_id uuid references profiles(id),
  target_resource_id uuid,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index idx_audit_admin on admin_audit_log(admin_id, created_at desc);
```

### Row-Level Security (políticas base)

```sql
-- Habilitar RLS en todas las tablas
alter table profiles enable row level security;
alter table credit_balances enable row level security;
alter table credit_transactions enable row level security;
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table campaigns enable row level security;
alter table projects enable row level security;
alter table generations enable row level security;
alter table media_references enable row level security;
alter table collections enable row level security;
alter table collection_items enable row level security;
alter table voice_clones enable row level security;
alter table brand_kits enable row level security;
alter table characters enable row level security;
alter table presets enable row level security;
alter table credit_purchases enable row level security;
alter table model_pricing enable row level security;
alter table notifications enable row level security;
alter table admin_audit_log enable row level security;

-- Helper: ¿es admin?
create or replace function is_admin() returns boolean as $$
  select exists(
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

-- Helper: ¿pertenece al workspace?
create or replace function is_workspace_member(ws_id uuid) returns boolean as $$
  select exists(
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$ language sql security definer stable;

-- profiles: el usuario ve su propio perfil; admin ve todos
create policy "profiles_self_read" on profiles for select using (id = auth.uid() or is_admin());
create policy "profiles_self_update" on profiles for update using (id = auth.uid());
create policy "profiles_admin_all" on profiles for all using (is_admin());

-- credit_balances: solo el dueño y admin
create policy "balances_self_read" on credit_balances for select using (user_id = auth.uid() or is_admin());
create policy "balances_admin_write" on credit_balances for all using (is_admin());

-- credit_transactions: el usuario solo LEE las suyas. Las inserciones SIEMPRE
-- vienen de funciones `security definer` (reserve/confirm/refund/grant) o de
-- server actions usando service_role. Bloqueamos insert directo de usuarios
-- para que nadie pueda auto-acreditarse.
create policy "tx_self_read" on credit_transactions for select using (user_id = auth.uid() or is_admin());
create policy "tx_admin_only_write" on credit_transactions for insert with check (is_admin());

-- workspaces y membership
create policy "ws_member_read" on workspaces for select using (is_workspace_member(id) or is_admin());
create policy "ws_owner_write" on workspaces for all using (owner_id = auth.uid() or is_admin());

-- workspace_members: cualquier miembro lista la membresía; solo el owner del
-- workspace (o admin) puede invitar/quitar miembros. El owner se inserta
-- automáticamente via trigger al crear el workspace (ver sección de triggers).
create policy "ws_members_read" on workspace_members
  for select using (is_workspace_member(workspace_id) or is_admin());
create policy "ws_members_owner_write" on workspace_members
  for all using (
    exists(select 1 from workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
    or is_admin()
  );

-- campaigns/projects/generations/etc
-- Patrón: SELECT/UPDATE/DELETE por membresía del workspace; INSERT exige
-- además que `user_id = auth.uid()` para que un miembro no pueda crear filas
-- "a nombre de" otro usuario y cargarle créditos.
create policy "campaigns_member" on campaigns for all using (is_workspace_member(workspace_id) or is_admin());
create policy "projects_member" on projects for all using (
  exists(select 1 from campaigns c where c.id = campaign_id and is_workspace_member(c.workspace_id)) or is_admin()
);

create policy "generations_member_read" on generations
  for select using (is_workspace_member(workspace_id) or is_admin());
create policy "generations_member_insert" on generations
  for insert with check (is_workspace_member(workspace_id) and user_id = auth.uid());
create policy "generations_owner_update" on generations
  for update using (user_id = auth.uid() or is_admin());
create policy "generations_owner_delete" on generations
  for delete using (user_id = auth.uid() or is_admin());
create policy "media_refs_member_read" on media_references
  for select using (is_workspace_member(workspace_id) or is_admin());
create policy "media_refs_member_insert" on media_references
  for insert with check (is_workspace_member(workspace_id) and user_id = auth.uid());
create policy "media_refs_owner_update" on media_references
  for update using (user_id = auth.uid() or is_admin());
create policy "media_refs_owner_delete" on media_references
  for delete using (user_id = auth.uid() or is_admin());
create policy "collections_member" on collections for all using (is_workspace_member(workspace_id) or is_admin());

-- collection_items: el acceso depende del workspace dueño de la colección.
create policy "collection_items_member" on collection_items for all using (
  exists(select 1 from collections c where c.id = collection_id and is_workspace_member(c.workspace_id))
  or is_admin()
);

create policy "brand_kits_member" on brand_kits for all using (is_workspace_member(workspace_id) or is_admin());
create policy "characters_member" on characters for all using (is_workspace_member(workspace_id) or is_admin());
create policy "voices_owner" on voice_clones for all using (user_id = auth.uid() or is_admin());

-- presets: públicos visibles para todos, privados solo del dueño
create policy "presets_read" on presets for select using (is_public or user_id = auth.uid() or is_admin());
create policy "presets_write" on presets for all using (user_id = auth.uid() or is_admin());

-- credit_purchases
create policy "purchases_self" on credit_purchases for select using (user_id = auth.uid() or is_admin());
create policy "purchases_create" on credit_purchases for insert with check (user_id = auth.uid());
create policy "purchases_admin_update" on credit_purchases for update using (is_admin());

-- model_pricing: lectura pública (necesaria para el estimador en cliente),
-- solo admin puede modificar.
create policy "pricing_read" on model_pricing for select using (true);
create policy "pricing_admin_insert" on model_pricing for insert with check (is_admin());
create policy "pricing_admin_update" on model_pricing for update using (is_admin());
create policy "pricing_admin_delete" on model_pricing for delete using (is_admin());

-- notifications: el usuario solo ve y marca como leídas las suyas. Inserciones
-- vienen de funciones internas / server actions con service_role.
create policy "notif_self_read" on notifications for select using (user_id = auth.uid() or is_admin());
create policy "notif_self_update" on notifications for update using (user_id = auth.uid());
create policy "notif_admin_insert" on notifications for insert with check (is_admin());

-- audit_log: solo admin
create policy "audit_admin" on admin_audit_log for all using (is_admin());
```

### Storage buckets

```
- outputs/        (privado, signed URLs) → generaciones finales
- references/     (privado) → uploads de usuarios
- voice-samples/  (privado) → audio para voice cloning
- thumbnails/     (público con cache largo)
- avatars/        (público)
- brand-assets/   (privado, signed URLs)
```

---

## 5. Sistema de créditos

**Base:** 1 crédito ≈ $0.002 USD de costo interno.

### Tabla de precios (cargar en `model_pricing` al hacer seed)

Convención: `variant` es la **tier** (resolución/duración). `unit_size` y `unit_label` describen la **proporcionalidad** (si aplica). Para tarifas tier fijas, `unit_size=null`.

#### Video — costo fijo por variant

| Provider | Model | Variant | Créditos | unit_size | unit_label |
|---|---|---|---|---|---|
| veo | veo-3.1-generate-preview | 1080p_8s | 2000 | null | — |
| veo | veo-3.1-generate-preview | 4k_8s | 3800 | null | — |
| veo | veo-3.1-generate-preview | 720p_8s | 1500 | null | — |
| veo | veo-3.1-fast-generate-preview | 1080p_8s | 750 | null | — |
| veo | veo-3.1-fast-generate-preview | 720p_8s | 500 | null | — |
| veo | veo-3.1-lite-generate-preview | 720p_8s | 400 | null | — |
| kling | kling-video-o1 | pro_5s | 700 | null | — |
| kling | kling-video-o1 | pro_10s | 1400 | null | — |
| kling | kling-3-0-omni | pro_5s_audio | 500 | null | — |
| kling | kling-v2.6-pro | std_5s | 350 | null | — |
| kling | kling-v2.6-pro | std_10s | 700 | null | — |
| kling | kling-v2.6-std | std_5s | 220 | null | — |
| kling | kling-v2.5-turbo | std_5s | 180 | null | — |
| kling | extend | default | 350 | 5 | seconds |
| kling | lip-sync | default | 220 | null | — |

#### Imagen — Nano Banana fijo, FLUX proporcional por MP

| Provider | Model | Variant | Créditos | unit_size | unit_label |
|---|---|---|---|---|---|
| nano-banana | gemini-3-pro-image-preview | 1k | 60 | null | — |
| nano-banana | gemini-3-pro-image-preview | 2k | 90 | null | — |
| nano-banana | gemini-3-pro-image-preview | 4k | 120 | null | — |
| nano-banana | gemini-3.1-flash-image-preview | 1k | 30 | null | — |
| nano-banana | gemini-3.1-flash-image-preview | 2k | 50 | null | — |
| flux | flux-2-pro-preview | default | 25 | 1 | mp |

**Multiplicadores (aplicados en el estimador en cliente y re-validados en server action; viven en código, no en DB — cambiarlos requiere redeploy):**
- Edición conversacional Nano Banana: +50% sobre base
- Grounding con Google Search: +20%
- Referencias FLUX (por referencia adicional): +15 créditos cada una

#### Audio — TTS proporcional por 1000 chars, resto fijo

| Provider | Model | Variant | Créditos | unit_size | unit_label |
|---|---|---|---|---|---|
| elevenlabs | eleven_v3 | default | 350 | 1000 | chars |
| elevenlabs | eleven_multilingual_v2 | default | 200 | 1000 | chars |
| elevenlabs | eleven_flash_v2_5 | default | 70 | 1000 | chars |
| elevenlabs | voice-clone | setup | 800 | null | — (pago único al crear la voz; usarla luego en TTS cobra la tarifa normal del modelo TTS elegido) |
| elevenlabs | sound-generation | default | 40 | null | — |
| elevenlabs | dubbing | default | 800 | 60 | seconds |

### Reglas operativas

1. **Estimación en cliente:** función pura `estimateCredits(params)` muestra costo antes de generar.
2. **Costos proporcionales:** `model_pricing.credits_cost` es una **tarifa**, no un costo final. Cuando `unit_size` no es null, el costo real es `ceil(units / unit_size) * credits_cost`. Ejemplos:
   - ElevenLabs TTS: `unit_size=1000`, `unit_label='chars'`. 4,200 chars → ceil(4.2) × tarifa.
   - FLUX por megapíxel: `unit_size=1`, `unit_label='mp'`. 2 MP → 2 × tarifa.
3. **Reserva al encolar:** al pasar `status='queued'`, sumar a `credit_balances.pending` y restar de `balance`.
4. **Confirmación al éxito:** mover de `pending` a `credits_charged` en la generación.
5. **Refund al fallo, timeout o cancelación:** restaurar `balance` desde `pending`.
6. **Free tier:** 500 créditos al registrarse (transacción `signup_bonus`, creada por trigger `handle_new_user`).
7. **Pre-confirmación de lotes:** acciones que disparan ≥2 generaciones (storyboard, auto-variaciones, smart crop multi-formato, pipeline voz+video) muestran un dialog con el costo total y exigen confirmación explícita antes de encolar. Si el balance es insuficiente para el lote completo, el dialog ofrece comprar un pack o reducir el alcance.
8. **Compras simbólicas:** ver sección 10.

### Funciones SQL para créditos (atómicas)

```sql
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

-- Aprobación atómica de compra: actualiza purchase, acredita balance,
-- registra transacción + notificación + audit log en una sola transacción.
-- Solo callable por admin (verificado dentro de la función).
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

-- Ajuste manual de créditos por admin (acción "Ajustar créditos" del panel
-- /admin/users). p_delta puede ser positivo (grant) o negativo (debit).
-- Hace balance + transacción + notificación + audit log atómicos.
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
```

### Triggers obligatorios

```sql
-- Al crear un usuario en auth.users:
-- 1) Crear su profile (rol 'admin' si el email está en la lista de admins iniciales)
-- 2) Crear credit_balances con 500 créditos de bienvenida
-- 3) Registrar la transacción signup_bonus
-- Lista de emails admin definida vía GUC `app.admin_emails` (coma-separados)
-- y seteada en Supabase con: alter database postgres set app.admin_emails = '...';
create or replace function handle_new_user() returns trigger as $$
declare
  v_role text := 'user';
  v_admin_emails text := coalesce(current_setting('app.admin_emails', true), '');
  v_email text := coalesce(new.email, new.raw_user_meta_data->>'email');
begin
  -- Algunos providers OAuth (raros) no rellenan auth.users.email; intentamos
  -- recuperarlo del metadata. Si tampoco existe, abortamos: profiles.email es
  -- NOT NULL UNIQUE y dejar al usuario sin profile romperá el resto de la app.
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Al crear un workspace, insertar al owner como miembro con rol 'owner'.
create or replace function handle_new_workspace() returns trigger as $$
begin
  insert into workspace_members(workspace_id, user_id, role)
    values (new.id, new.owner_id, 'owner')
    on conflict do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_workspace_created
  after insert on workspaces
  for each row execute function handle_new_workspace();

-- updated_at automático en tablas con esa columna.
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated_at before update on profiles
  for each row execute function touch_updated_at();
create trigger trg_credit_balances_updated_at before update on credit_balances
  for each row execute function touch_updated_at();
create trigger trg_model_pricing_updated_at before update on model_pricing
  for each row execute function touch_updated_at();
```

### Realtime publication

Supabase Realtime depende de la publication `supabase_realtime`. Hay que agregar
explícitamente las tablas que el cliente va a observar; sin esto, los `subscribe()`
no entregan eventos.

```sql
alter publication supabase_realtime add table generations;
alter publication supabase_realtime add table credit_balances;
alter publication supabase_realtime add table notifications;
```

- `generations` → la UI muestra status en vivo del job actual.
- `credit_balances` → la pill de créditos en topbar se actualiza al instante (reserve, refund, purchase).
- `notifications` → badge en topbar cuando se aprueba una compra o termina un job.

RLS aplica también a los eventos de Realtime: cada cliente solo recibe filas que sus políticas le permiten leer.

### Admin inicial

No hay UI para crear el primer admin. Dos opciones soportadas:

1. **Recomendado:** setear el GUC `app.admin_emails` en Supabase antes del primer signup. El trigger `handle_new_user` eleva automáticamente cualquier email que coincida.
   ```sql
   alter database postgres set app.admin_emails = 'tu@correo.com,otro@correo.com';
   -- Importante: el ajuste persiste pero requiere reconexión de pgbouncer.
   -- En Supabase: Dashboard → Settings → Database → Restart server, o esperar
   -- el reciclado automático del pool (~minutos).
   ```
2. **Manual / fallback:** después de hacer signup normal, ejecutar una vez con service_role:
   ```sql
   update profiles set role = 'admin' where email = 'tu@correo.com';
   ```
   Esta operación debe quedar registrada manualmente en `admin_audit_log`.

> Si el GUC no funciona por el pooling de Supabase (poco común pero posible en planes restringidos), la ruta manual siempre funciona. Para más de 2-3 admins, considera una tabla `admin_email_allowlist(email text primary key)` que el trigger consulte en lugar del GUC.

### Nota sobre `SECURITY DEFINER` y RLS

Todas las funciones marcadas `security definer` (`reserve_credits`, `confirm_credits`, `refund_credits`, `approve_purchase`, `reject_purchase`, `admin_grant_credits`, `handle_new_user`, `handle_new_workspace`, `is_admin`, `is_workspace_member`) deben ser creadas por el rol `postgres` (es el caso por defecto al correr migraciones en Supabase). Ese rol tiene `BYPASSRLS`, por lo que las inserciones en `credit_transactions`, `notifications` y `profiles` desde estas funciones saltan las políticas RLS y operan sin restricción. Si por alguna razón se ejecuta una migración con un rol distinto, hay que `alter function ... owner to postgres` antes de usarlas.

---

## 6. Cola de jobs (polling con QStash)

### Patrón unificado

```
1. Cliente → server action submitGeneration(params)
2. Server action:
   a. Valida con zod
   b. Calcula credits_estimated
   c. Llama reserve_credits() — si falla, error 402
   d. Inserta generations con status='queued', timeout_at = now() + interval correspondiente
   e. Encola en QStash: POST /api/jobs/process con {generation_id, action:'submit'}
   f. Devuelve generation_id al cliente
3. Cliente se suscribe vía Supabase Realtime a la fila
4. Worker /api/jobs/process (cada invocación):
   a. Verifica firma de QStash
   b. Lee generación; si status ya es terminal (done/failed/canceled) → ack y termina
   c. Si cancel_requested=true o now() > timeout_at → cancelar/fallar + refund
   d. Si action='submit': llama proveedor, guarda task_id, re-encola action='poll'
   e. Si action='poll':
        - poll_attempts++; si supera MAX_POLLS por proveedor → timeout + refund
        - consulta proveedor; si sigue procesando → re-encola con delay
        - si completó → descarga, sube a Storage, thumbnail, confirma créditos
5. Al completar:
   a. Descarga output del proveedor (FLUX en <10 min, Kling <24h, Veo <2 días)
   b. Sube a Supabase Storage bucket 'outputs/'
   c. Genera thumbnail: imagen → sharp; video → ffmpeg con `-ss 0 -frames:v 1`
      (extrae solo el primer frame, evita exceder 60s en videos 4K)
   d. Llama confirm_credits()
   e. Update generations con output_url, thumbnail_url, duration_seconds,
      file_size_bytes, credits_charged=credits_estimated (o el real si difiere),
      processing_ms=now()-created_at, status='done', completed_at=now()
6. Al fallar / timeout / cancelar:
   a. Llama refund_credits()
   b. Update generations con status='failed' o 'canceled', error_message,
      credits_charged=0, completed_at=now()
```

### Límites de polling y timeouts por proveedor

Cota dura: QStash free tier = **500 mensajes/día**. Una generación Veo larga puede consumir 30–40 mensajes. Ajustar los intervalos en consecuencia:

| Proveedor | Delay poll inicial | Backoff después de N polls | MAX_POLLS | timeout_at | Notas |
|---|---|---|---|---|---|
| FLUX | 2s | 5s tras 10 polls | 60 | now() + 5 min | URLs expiran a 10 min, urgente |
| Kling | 10s | 20s tras 6 polls | 30 | now() + 10 min | Std ~30s, Pro ~60s |
| Veo | 15s | 30s tras 4 polls | 24 | now() + 8 min | Hasta 6 min de generación |
| Nano Banana | sync | — | — | — | Va síncrono dentro de 60s |
| ElevenLabs | sync (stream) | — | — | — | Captura del stream en el submit. Para >4,000 chars, chunkear (ver nota) |

`MAX_POLLS` y `timeout_at` son redundantes a propósito: el primero protege contra runaway, el segundo contra polls que no se ejecutaron (QStash atrasado).

**Chunking de ElevenLabs:** una llamada TTS con texto > ~4,000 chars puede tardar más de 60s en `eleven_multilingual_v2`/`eleven_v3` y exceder el límite de Vercel Hobby. Para textos largos, el adapter divide el texto en chunks de ~3,000 chars por frase, genera cada uno como una sub-llamada y concatena los buffers MP3 antes de subir. Cada generación grande queda como una sola fila en `generations` (no se crean sub-rows), y `processing_ms` refleja el tiempo total.

### Cancelación

El usuario puede cancelar desde la UI mientras `status in ('queued','processing')`:

1. Server action `cancelGeneration(id)`: setea `cancel_requested=true`. No llama al proveedor.
2. El siguiente tick del worker detecta la bandera y:
   - Llama al endpoint del proveedor si existe (`POST /v1/videos/{task_id}/cancel` en Kling; Veo y FLUX no soportan cancelación remota — se ignora la respuesta y se deja terminar al proveedor sin descargar el output).
   - Cambia `status='canceled'` y dispara `refund_credits()`.
3. Si el job ya completó antes de que llegue el cancel → se ignora (`status='done'` es terminal).

### Configuración del worker

```typescript
// app/api/jobs/process/route.ts
export const maxDuration = 60; // tope Vercel Hobby
export const runtime = 'nodejs';
```

### Re-encolado para polling (sin webhooks)

```typescript
// Delay según proveedor + backoff por número de polls (ver tabla arriba)
function nextDelay(provider: string, attempts: number): string {
  if (provider === 'flux')  return attempts < 10 ? '2s'  : '5s';
  if (provider === 'kling') return attempts < 6  ? '10s' : '20s';
  if (provider === 'veo')   return attempts < 4  ? '15s' : '30s';
  return '10s';
}

await qstash.publishJSON({
  url: `${process.env.NEXT_PUBLIC_APP_URL}/api/jobs/process`,
  body: { generationId, action: 'poll' },
  delay: nextDelay(provider, pollAttempts),
});
```

### Estructura de adapters

```
/lib/providers/
  ├── veo.ts          → submitJob, pollStatus, downloadOutput
  ├── kling.ts        → submitJob, pollStatus
  ├── nano-banana.ts  → generate (sync, sin polling)
  ├── flux.ts         → submitJob, pollStatus
  └── elevenlabs.ts   → tts, cloneVoice, soundEffect
```

Cada adapter implementa interfaz común:

```typescript
interface ProviderAdapter {
  submit(params: GenerationParams): Promise<{ taskId: string; isSync?: boolean }>;
  poll?(taskId: string): Promise<PollResult>;
  download(result: any): Promise<Buffer>;
}
```

**Nota:** Nano Banana puede ir sync dentro del límite de 60s. Resto siempre por polling.

---

## 7. Selector de modelo (router automático)

Lógica en `/lib/router/model-selector.ts`:

```typescript
function selectImageModel(params: ImageParams): { provider, model, variant } {
  if (params.preset === 'photo-product' || params.preset === 'portrait-photoreal') {
    // FLUX cobra por MP — el estimador multiplica por params.megapixels
    return { provider: 'flux', model: 'flux-2-pro-preview', variant: 'default' };
  }
  if (params.hasTextInImage || params.references.length > 8 || params.useGrounding) {
    return { provider: 'nano-banana', model: 'gemini-3-pro-image-preview', variant: params.resolution };
  }
  if (params.priority === 'speed') {
    return { provider: 'nano-banana', model: 'gemini-3.1-flash-image-preview', variant: '1k' };
  }
  return { provider: 'nano-banana', model: 'gemini-3-pro-image-preview', variant: '2k' };
}

function selectVideoModel(params: VideoParams): { provider, model, variant } {
  if (params.priority === 'premium' || params.needsNativeAudio) {
    const variant = params.resolution === '4k' ? '4k_8s' : '1080p_8s';
    return { provider: 'veo', model: 'veo-3.1-generate-preview', variant };
  }
  if (params.needsLipSync) {
    return { provider: 'kling', model: 'kling-3-0-omni', variant: 'pro_5s_audio' };
  }
  if (params.characterId || params.references.length > 0) {
    return { provider: 'kling', model: 'kling-v2.6-pro', variant: `std_${params.duration}s` };
  }
  if (params.priority === 'speed') {
    return { provider: 'kling', model: 'kling-v2.5-turbo', variant: 'std_5s' };
  }
  return { provider: 'veo', model: 'veo-3.1-fast-generate-preview', variant: '1080p_8s' };
}

function selectAudioModel(params: AudioParams): { provider, model, variant } {
  if (params.mode === 'sound-effect') {
    return { provider: 'elevenlabs', model: 'sound-generation', variant: 'default' };
  }
  if (params.mode === 'voice-clone-setup') {
    return { provider: 'elevenlabs', model: 'voice-clone', variant: 'setup' };
  }
  if (params.priority === 'speed' || params.realtime) {
    return { provider: 'elevenlabs', model: 'eleven_flash_v2_5', variant: 'default' };
  }
  if (params.expressive || params.hasInlineTags) {
    return { provider: 'elevenlabs', model: 'eleven_v3', variant: 'default' };
  }
  return { provider: 'elevenlabs', model: 'eleven_multilingual_v2', variant: 'default' };
}
```

El usuario puede aceptar la sugerencia o forzar uno manualmente desde la UI.

---

## 8. Estructura de la app

### Rutas

```
/                       → landing pública
/login, /signup         → auth con Google + email
/onboarding             → 3 pasos: nombre del workspace, "área" (vertical/rol:
                          marketing, agencia, freelance, e-commerce, startup,
                          empresa SaaS, otro — se guarda en profiles.area para
                          segmentar métricas), confirmación de bono de bienvenida

/app                    → dashboard (workspaces, campañas, recientes)
/app/create/image       → generación imagen
/app/create/video       → generación video
/app/create/audio       → generación audio
/app/campaigns          → lista de campañas
/app/campaigns/[id]     → detalle (proyectos dentro)
/app/projects/[id]      → detalle (generaciones, kanban opcional)
/app/library            → biblioteca (todas las generaciones + referencias)
/app/references         → gestión de referencias
/app/characters         → cast de personajes
/app/brand-kits         → brand kits del workspace
/app/voices             → voces clonadas
/app/presets            → presets propios y de la comunidad
/app/storyboard         → modo storyboard
/app/billing            → balance, historial, packs simbólicos

/admin                  → dashboard admin
/admin/users            → gestión de usuarios
/admin/generations      → vista global de jobs
/admin/purchases        → aprobar compras pendientes
/admin/pricing          → editar tabla model_pricing
/admin/audit            → log de auditoría

/api/jobs/process       → worker QStash (procesa cada generación)
/api/jobs/cleanup       → schedule QStash diario (purga generations, refs y outputs viejos)
```

### Componentes principales (shadcn/ui)

```
components/
  ui/                          ← shadcn primitives
  generation/
    GenerationForm.tsx         ← formulario unificado con tabs por tipo
    ModelSelector.tsx          ← cards de modelos con costo + descripción
    PromptInput.tsx            ← textarea con prompt assistant integrado
    ReferencesPanel.tsx        ← lateral drag-drop
    ParamsPanel.tsx            ← controles dinámicos por modelo
    CostPreview.tsx            ← muestra créditos en tiempo real
    GenerateButton.tsx         ← con estado de loading y reserva
    ResultGallery.tsx          ← grid de resultados con acciones
  library/
    GenerationCard.tsx
    ReferenceCard.tsx
    CharacterCard.tsx
  admin/
    UsersTable.tsx
    CreditAdjustDialog.tsx
    PricingEditor.tsx
    MetricsDashboard.tsx
  layout/
    Sidebar.tsx
    Topbar.tsx                 ← workspace switcher + credit pill + user menu
    MobileBottomNav.tsx
```

---

## 9. Panel de admin

### Dashboard (`/admin`)

Métricas en cards:
- Usuarios totales / activos 7d / 30d
- Generaciones por tipo último mes (chart de barras)
- Créditos consumidos vs cargados
- Top 10 usuarios por consumo
- Errores recientes (jobs `status='failed'`)

### Usuarios (`/admin/users`)

Tabla paginada con columnas: email, nombre, rol, status, balance, registrado, último uso. Filtros por rol, status, búsqueda. Acciones por fila:

- **Ver detalle** → balance, historial de transacciones, generaciones, compras
- **Ajustar créditos** → dialog con input ± y razón obligatoria → llama `admin_grant_credits(user_id, delta, reason)` (función SQL atómica en sección 5: actualiza balance, inserta transacción, notificación al usuario y audit log en una sola transacción; rechaza si dejaría el balance en negativo).
- **Suspender / Activar**
- **Cambiar rol** (user ↔ admin)
- **Eliminar** (soft delete vía status)

### Generaciones (`/admin/generations`)

Vista global con filtros: tipo, modelo, status, usuario, rango de fechas. Permite re-ejecutar o refund manual.

### Compras (`/admin/purchases`)

Lista de `credit_purchases` con `status='pending'`. Cada fila muestra: usuario, pack, créditos, MXN, fecha. Acciones: **Aprobar** → llama `approve_purchase(id)` / **Rechazar** → llama `reject_purchase(id, motivo)`. Ambas funciones (definidas en sección 5) acreditan/actualizan, registran transacción + notificación + audit log de forma atómica.

### Precios (`/admin/pricing`)

Tabla editable de `model_pricing` (créditos por variant). Cambios en vivo sin redeploy. Toda edición registrada en audit log.

### Auditoría (`/admin/audit`)

Tabla read-only de `admin_audit_log` paginada.

---

## 10. Compra simbólica de créditos

Sin Stripe. UI en `/app/billing`:

| Pack | Créditos | Precio MXN |
|---|---|---|
| Starter | 2,000 | $99 |
| Creator | 10,000 | $399 |
| Pro | 50,000 | $1,499 |
| Studio | 200,000 | $4,999 |

Flujo:
1. Usuario hace clic en "Comprar" → crea `credit_purchases` con `status='pending'`. La constraint `pack_catalog_match` garantiza que `credits` y `price_mxn` correspondan al `pack_id` (impide forjar compras de Studio por $1).
2. UI muestra: "Tu compra está en revisión. Te notificaremos al aprobarse."
3. Admin entra a `/admin/purchases` → llama `approve_purchase(id)` o `reject_purchase(id, motivo)` (funciones SQL atómicas definidas en sección 5). Cada acción actualiza la compra, el balance (si aprobada), `credit_transactions`, `notifications` y `admin_audit_log` en una sola transacción.
4. Usuario recibe el push de Realtime (balance + badge de notificación en topbar) sin necesidad de estar en `/app/billing`.

---

## 11. Valor agregado (features que diferencian)

### 11.1 Prompt Assistant
Auxiliar (Gemini Flash) que reescribe el prompt del usuario adaptado a la estructura óptima del modelo elegido:

- **Veo:** Subject + Action + Style + Camera + Composition + Focus + Ambiance
- **FLUX:** lente + iluminación + ángulo + composición
- **Nano Banana:** narrativa descriptiva, texto entre comillas al inicio
- **ElevenLabs v3:** sugiere tags expresivos inline

Componente: `PromptInput.tsx` con botón "Mejorar prompt" que abre dialog con sugerencia + diff.

### 11.2 Brand Kit
Workspace tiene N brand kits. Cada uno define: paleta, tipografías, logo, tono, guidelines. Al activar toggle "Usar brand kit" en una generación:

- **Imagen:** logo y assets se cargan como referencias automáticamente; colores se mencionan en prompt
- **Video:** mismo + guidelines de tono en prompt
- **Audio:** tone_description se inyecta como contexto

### 11.3 Cast de personajes
Tabla `characters` con bundle de 3–5 referencias por personaje. Al seleccionar un personaje en una generación, sus referencias se inyectan automáticamente, **truncadas al máximo soportado por el modelo destino**:

| Modelo | Máx referencias |
|---|---|
| Nano Banana Pro | 11 (5 personajes + 6 objetos) |
| Nano Banana 2 | 14 (4 personajes + 10 objetos) |
| FLUX 2 Pro | 8 |
| Veo 3.1 | 3 |

El inyector mantiene prioridad: refs del personaje primero, luego refs manuales del usuario, recortando lo que sobre.

### 11.4 Storyboard mode (`/app/storyboard`)
Editor de tira de 4–8 frames:
1. Usuario describe cada frame en orden
2. Selecciona personajes del cast (referencias se inyectan y truncan al máx del modelo)
3. Sistema muestra **costo total estimado** (`N frames × tarifa Nano Banana Pro`) y exige confirmación
4. Genera todas las imágenes con Nano Banana Pro manteniendo refs (encoladas en paralelo). Cada frame es una fila en `generations` con el mismo `batch_id` y `batch_kind='storyboard'`; el orden se guarda en `params.frame_index`.
5. Opción "Animar storyboard" → vuelve a calcular costo (N × tarifa Kling/Veo) y exige nueva confirmación antes de generar los videos. Los videos comparten un nuevo `batch_id` y enlazan cada uno a su frame original via `parent_generation_id`.

### 11.5 Auto-variaciones
Tras completar generación, sistema sugiere 3 variantes con un clic:
- "Misma escena, golden hour"
- "Vertical 9:16 para reels"
- "Estilo cinematográfico"

Cada variante reusa seed cuando aplica. **Cada variante es una generación independiente y se cobra por separado**; el botón muestra el costo total (3 × tarifa) y pide confirmación. Las 3 variantes comparten `batch_id` y `batch_kind='variations'`, y cada una tiene `parent_generation_id` apuntando al original.

### 11.6 Smart crop multi-formato
Una imagen → exporta 1:1, 9:16, 16:9, 4:5 automáticamente. Usa Nano Banana en modo edición conversacional para reframe inteligente (no crop ciego). **Cada formato es una generación de Nano Banana**; el usuario selecciona qué formatos quiere y ve el costo total antes de confirmar. Comparten `batch_id` y `batch_kind='smart_crop'`, con `parent_generation_id` apuntando al original.

### 11.7 Voz + video sincronizado
Pipeline guiado (3 generaciones encadenadas, cada una cobra créditos por separado y el usuario ve el costo total antes de confirmar):

1. **Audio:** generar voz en ElevenLabs (Multilingual v2 o v3) → MP3 en Storage.
2. **Video base:** generar video con Kling 2.6 Pro o Veo (sin audio o con audio ignorado). `parent_generation_id = audio_id` para que la UI vea la cadena.
3. **Lip-sync:** llamar a `POST /v1/videos/lip-sync` de Kling pasando el `video_url` (del paso 2) + `audio_url` (del paso 1). `parent_generation_id = video_id`. Devuelve un nuevo video con lip-sync.

Las 3 generaciones comparten `batch_id` y `batch_kind='lipsync_pipeline'`.

El árbol de iteraciones (sección 11.9) renderiza esta cadena como un branch lineal de 3 nodos. Si el lip-sync falla, los pasos 1 y 2 ya están pagados y sus outputs siguen disponibles (no se hace refund en cascada).

Nota: Kling Omni tiene audio nativo pero **a partir de prompt**, no de un MP3 externo. Para usar una voz ya generada (clonada o no), el camino correcto es el endpoint `/lip-sync` aplicado al video.

### 11.8 Grounding con datos en tiempo real
Toggle en Nano Banana Pro: "Usar datos en tiempo real (Google Search)". Permite infografías con clima actual, stocks, eventos.

### 11.9 Historial visual con árbol de iteraciones
`parent_generation_id` forma DAG. UI tipo Git branch en panel lateral del detalle de generación.

### 11.10 Comparador A/B
Selección múltiple en galería → botón "Comparar" → split screen sincronizado.

### 11.11 Timeline editor ligero
En `/app/projects/[id]` tab "Timeline": permite concatenar videos generados + añadir pista de voz/música/SFX → export MP4 1080p. Cliente-side con ffmpeg.wasm.

**Límites conocidos de ffmpeg.wasm:** memoria del navegador ~2 GB, sin GPU. Funciona bien para timelines de hasta ~2 min en 1080p; para 4K o duraciones largas se muestra warning y se sugiere bajar a 1080p antes de exportar.

### 11.12 Plantillas comunitarias
`presets` con `is_public=true` aparecen en galería pública. Cada uso incrementa `uses_count`.

---

## 12. Diseño UX/UI

### Principios
- **Sin emojis** en UI.
- Tipografía: Inter (UI) + Geist (display para títulos).
- Paleta: zinc-950 base (dark default), acento violeta eléctrico (`#7c3aed`).
- Modo claro + oscuro. **Dark por defecto** (estética studio).
- Espaciado generoso, bordes sutiles (`border-zinc-800`), sombras suaves.
- Transitions 150–250ms, skeletons en loading, estados hover claros.

### Layout principal (desktop)

```
┌──────────┬─────────────────────────────────────────┐
│ Sidebar  │  Topbar [workspace ▾]  [créditos] [usr] │
│ 240px    ├─────────────────────────────────────────┤
│          │                                          │
│ Inicio   │           Canvas / Grid                  │
│ Crear ▾  │                                          │
│ ├ Img    │                                          │
│ ├ Vid    │                                          │
│ └ Aud    │                                          │
│ Campañas │                                          │
│ Proyectos│                                          │
│ Library  │                                          │
│ Refs     │                                          │
│ Voces    │                                          │
│ Brand    │                                          │
│ Cast     │                                          │
│ ────     │                                          │
│ Billing  │                                          │
│ Settings │                                          │
└──────────┴──────────────────────────────────────────┘
```

### Pantalla de generación (crítica)

Layout 2 columnas:

**Izquierda (controles):**
- Tabs: Imagen / Video / Audio
- Selector de modelo con cards (auto vs manual)
- Prompt input con botón "Mejorar prompt"
- Negative prompt (collapsible)
- Params dinámicos según modelo elegido
- Toggle Brand Kit
- Selector de personaje (cast)
- Panel referencias (drag-drop)
- Botón generar grande con **costo en créditos en tiempo real**

**Derecha (preview/galería):**
- Mientras procesa: card con progress bar + tiempo estimado + botón cancelar
- Al completar: grid de resultados con acciones (descargar, usar como ref, variar, comparar, mover a colección)
- Histórico de la sesión actual

### Responsive

- Mobile: sidebar se convierte en bottom-nav (5 items principales)
- Pantalla de generación pasa a tabs: "Controles" / "Preview"
- Drag-drop reemplazado por button "Añadir referencia" → picker
- Tablas admin con scroll horizontal + columnas prioritarias

---

## 13. Seguridad

- **RLS básico** habilitado en todas las tablas (políticas en sección 4).
- **Validación zod** en server actions.
- **Variables de entorno** nunca expuestas al cliente.
- **Service role key** solo en server actions y worker.
- **Outputs en Storage privado** con signed URLs (TTL 24 horas, re-firmadas en cada render del Server Component).
- **`personGeneration: allow_adult`** por defecto en Veo.

---

## 14. Infraestructura (Vercel + Supabase + Upstash)

### Planes utilizados

| Servicio | Plan | Costo |
|---|---|---|
| Vercel | Hobby | $0 |
| Supabase | Free | $0 |
| Upstash QStash | Free tier | $0 |
| APIs IA | uso real | variable |

### Configuración Vercel

Plan Hobby: 60s máx por función serverless, 100 GB bandwidth/mes, sin Cron.

El `maxDuration` se declara en el propio route como `export const maxDuration = 60` (ver sección 6). No es necesario duplicarlo en `vercel.json`; mantenerlo en un solo sitio evita inconsistencias.

- `runtime: 'nodejs'` en worker (sharp, SDKs pesados)
- Sin Vercel Cron (cleanup vía QStash schedule o cron-job.org gratis)
- Sin Vercel Blob (usamos Supabase Storage)
- Sin Sentry/Axiom (logs nativos de Vercel bastan para demo)
- Bandwidth: servir outputs **directo desde Supabase Storage** (no proxiar por Next.js) para evitar consumir los 100 GB de Vercel.

### Configuración Supabase

- Plan Free: 500 MB DB, 1 GB Storage, 50K MAU, 5 GB egress/mes, 200 conexiones realtime concurrentes
- Buckets configurados con políticas RLS
- Realtime habilitado para `generations`, `credit_balances` y `notifications` (las 3 tablas que la UI observa en vivo; ver sección 5 → "Realtime publication" para el SQL exacto)
- **CORS de Storage:** Supabase actual maneja CORS automáticamente para signed upload URLs y reads autenticados — no hay configuración per-bucket. (La nota original del spec era de una versión anterior; ver `docs/setup/supabase.md` §6.)

### Estrategia para no reventar los límites free de Supabase

- **Cleanup automático:** un schedule de QStash (recurrente, ver sección 14 → "Configuración Upstash QStash") apuntando a `/api/jobs/cleanup` ejecuta cada 24h y elimina:
  - `generations` con `status='failed'` o `'canceled'` con más de 7 días → la FK `on delete set null` deja vivas las `media_references` correspondientes.
  - `media_references` con `source='generation'` y `source_generation_id is null` con más de 24h (ya quedaron huérfanas tras el paso anterior).
  - Archivos en `outputs/` huérfanos (sin fila viva en `generations` ni en `media_references`) con más de 24h.
  - `notifications` con `read_at is not null` y más de 30 días.
- **Resolución default conservadora:** UI sugiere 1080p para video y 2K para imagen por defecto; 4K solo a petición explícita con warning de costo y espacio.
- **Signed URLs largas pero refrescadas en cada page load:** TTL **24 horas** en lugar de 1h, y los Server Components vuelven a firmar al renderizar, así un tab abierto durante días no rompe los videos. Para sesiones más largas, el cliente refresca cada 12h con un endpoint de re-firma.
- **Servir directamente desde Supabase** (no proxiar por Next.js) para no consumir bandwidth de Vercel.

### Notificaciones in-app

No hay servicio de email (Resend, Postmark) en la demo. Notificaciones se manejan así:

- Tabla `notifications(id, user_id, type, payload jsonb, read_at, created_at)` con RLS por `user_id`.
- Topbar muestra badge con conteo de no leídas, suscrito vía Realtime.
- Eventos que generan notificación: compra aprobada/rechazada, generación completada (opcional según preferencia del usuario), créditos ajustados por admin.

### Configuración Upstash QStash

- Free tier: 500 mensajes/día (suficiente para demo)
- Token con permisos publish
- Verificación de firma con `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY` (rotación). El `Receiver` de `@upstash/qstash` acepta ambas keys para que un rotation no rompa el worker.
- **Schedule de cleanup:** crear desde el dashboard de Upstash (o `qstash.schedules.create`) un schedule recurrente cada 24h apuntando a `https://<dominio>/api/jobs/cleanup` con `cron: '0 3 * * *'` (3am UTC). El endpoint sigue las mismas reglas (verifica firma) y ejecuta la lógica descrita en la sección 14 → "Estrategia para no reventar los límites free".

### Patrón crítico: subida de referencias

Vercel tiene límite de 4.5 MB en request body. **Subir referencias directo a Supabase Storage desde el cliente** con signed upload URLs, luego pasar solo el path al server action.

```typescript
// 1. Cliente solicita signed URL
const { data } = await supabase.storage
  .from('references')
  .createSignedUploadUrl(path);

// 2. Cliente sube directo a Supabase (no a Vercel)
await fetch(data.signedUrl, { method: 'PUT', body: file });

// 3. Cliente pasa path al server action
await submitGeneration({ ..., referencePath: path });
```

### Sin webhooks (polling siempre)

Para la demo se omite la integración con webhooks. El worker QStash se re-encola a sí mismo cada 2s (FLUX) o 10s (Veo/Kling) hasta que el job complete. Más simple, menos puntos de fallo en presentación.

---

## 15. Estructura del repositorio

```
zyra-studio/
├── app/
│   ├── (marketing)/
│   │   ├── page.tsx
│   │   └── layout.tsx
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   └── onboarding/page.tsx
│   ├── app/
│   │   ├── layout.tsx                  ← sidebar + topbar
│   │   ├── page.tsx                    ← dashboard
│   │   ├── create/
│   │   │   ├── image/page.tsx
│   │   │   ├── video/page.tsx
│   │   │   └── audio/page.tsx
│   │   ├── campaigns/
│   │   ├── projects/[id]/
│   │   ├── library/
│   │   ├── references/
│   │   ├── characters/
│   │   ├── brand-kits/
│   │   ├── voices/
│   │   ├── presets/
│   │   ├── storyboard/
│   │   └── billing/
│   ├── admin/
│   │   ├── layout.tsx                  ← middleware verifica role
│   │   ├── page.tsx
│   │   ├── users/
│   │   ├── generations/
│   │   ├── purchases/
│   │   ├── pricing/
│   │   └── audit/
│   └── api/
│       └── jobs/
│           ├── process/route.ts        ← worker QStash de generaciones
│           └── cleanup/route.ts        ← schedule diario de purga
├── components/
│   ├── ui/                             ← shadcn
│   ├── generation/
│   ├── library/
│   ├── admin/
│   └── layout/
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── middleware.ts
│   ├── providers/
│   │   ├── veo.ts
│   │   ├── kling.ts
│   │   ├── nano-banana.ts
│   │   ├── flux.ts
│   │   └── elevenlabs.ts
│   ├── router/
│   │   └── model-selector.ts
│   ├── credits/
│   │   ├── estimator.ts
│   │   └── operations.ts
│   ├── jobs/
│   │   ├── queue.ts                    ← QStash client
│   │   └── worker.ts                   ← procesa job
│   ├── prompt-assistant/
│   │   └── enhance.ts
│   ├── storage/
│   │   └── upload.ts
│   ├── schemas/                        ← zod schemas
│   └── utils.ts
├── server-actions/
│   ├── generations.ts
│   ├── workspaces.ts
│   ├── campaigns.ts
│   ├── projects.ts
│   ├── references.ts
│   ├── characters.ts
│   ├── brand-kits.ts
│   ├── voices.ts
│   ├── presets.ts
│   ├── purchases.ts
│   └── admin.ts
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql
│   │   ├── 002_rls_policies.sql
│   │   ├── 003_functions.sql
│   │   └── 004_seed_pricing.sql
│   └── config.toml
├── middleware.ts                       ← protege rutas /app y /admin,
│                                         redirige a /onboarding si el usuario
│                                         no tiene workspace creado
├── vercel.json                         ← config opcional (no duplica
│                                         maxDuration; ese va en el route)
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

---

## 16. Variables de entorno (.env.local template)

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Proveedores IA
GEMINI_API_KEY=
KLING_API_KEY=
KLING_API_BASE_URL=https://api.klingapi.com
BFL_API_KEY=
BFL_API_BASE_URL=https://api.bfl.ai
ELEVENLABS_API_KEY=

# QStash
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=     # par para rotación; el SDK acepta ambos al verificar

# App
NEXT_PUBLIC_APP_URL=https://tu-proyecto.vercel.app
```

---

## 17. Plan de implementación por fases

### Fase 1 — Fundación
- Setup Next.js + Supabase + shadcn
- Schema SQL completo + RLS + funciones de créditos
- Auth (Google + email/password) + onboarding
- Estructura de workspaces / campañas / proyectos
- Layout principal (sidebar + topbar + responsive)
- Panel admin básico (usuarios + créditos + auditoría)

### Fase 2 — Imagen
- Generación con Nano Banana Pro + FLUX 2 Pro
- Sistema de referencias (uploads directos a Supabase Storage)
- Router automático de modelo
- Selector de modelo en UI con costo en tiempo real
- Compras simbólicas + aprobación admin

### Fase 3 — Video + Audio
- Cola de jobs con QStash (polling recursivo)
- Adapters Veo 3.1 + Kling 3.0
- ElevenLabs (TTS + sound effects + voice cloning)
- Storage de outputs + thumbnails
- Realtime updates en UI

### Fase 4 — Studio features
- Prompt Assistant
- Brand Kit
- Cast de personajes
- Storyboard mode
- Smart crop multi-formato
- Auto-variaciones
- Comparador A/B

### Fase 5 — Polish
- Timeline editor ligero
- Plantillas comunitarias
- Dubbing + lip-sync pipelines
- Refinamiento UI/UX
- Datos seed para demo

---

## 18. Notas para el desarrollo

- **No exponer URLs de proveedores al cliente.** Siempre re-servir desde Supabase Storage.
- **Toda mutación pasa por server actions con validación zod.**
- **Reservar créditos antes de encolar, refund automático al fallo, timeout o cancelación.**
- **`credit_transactions` solo se inserta desde funciones `security definer`** (RLS bloquea inserts de usuarios).
- **Realtime de Supabase para status updates** (no polling desde cliente).
- **Polling de FLUX usa el `polling_url` devuelto, nunca hardcodear.**
- **Descarga de outputs Veo en máx 2 días, Kling 24h, FLUX 10 min** — el worker debe ser rápido.
- **Thumbnail de video con ffmpeg usa `-ss 0 -frames:v 1`** (un solo frame) para no exceder los 60s de Vercel Hobby en videos 4K.
- **Uploads directos a Supabase desde cliente** para esquivar el límite de 4.5 MB del request body de Vercel. CORS lo maneja Supabase automáticamente; no requiere setup adicional.
- **Polling siempre, sin webhooks** — menos puntos de fallo para la demo.
- **`maxDuration = 60`** declarado en el propio `/api/jobs/process` (no duplicar en `vercel.json`).
- **Truncar referencias al máximo del modelo destino** (Nano Banana Pro 11, FLUX 8, Veo 3) al inyectar personajes o brand kit.
- **Las acciones que disparan ≥2 generaciones** (storyboard, auto-variaciones, smart crop, pipeline voz+video) exigen confirmación con costo total y validación de balance antes de encolar.
- **Datos seed útiles para demo:** setear `app.admin_emails` antes del primer signup, crear 1 usuario regular con créditos, 2 brand kits, 1 cast de personajes, varios presets públicos, tabla `model_pricing` completa.
