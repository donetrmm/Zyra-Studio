# Fase A — Fundación V2

> **~2 días · ~16 horas**
>
> Deja el schema de campañas, el adapter de Seedance 2.0 y el seed de formatos listos para que
> las fases B–E construyan el Campaign Studio sobre algo sólido. Fuente de verdad:
> `ZyraStudioV2/ARQUITECTURA-Y-CAPACIDADES-V2.md` (en adelante "doc V2").

## Pre-requisitos

- Cuenta fal.ai creada y `FAL_KEY` disponible (no commitearlo; va en `.env.local` y Vercel).
- Doc V2 leído completo, en especial §4.2 (formatos), §4.6 (pricing) y §5.3 (modelo de datos).
- V1 estable en `main` (las 5 fases V1 cerradas).

## Objetivo

Al cerrar la fase:
1. El schema V2 existe: campañas orquestables, items de campaña, formatos, plantillas vivas,
   biblioteca de escenas, Brand Kit y Cast extendidos — con RLS completo.
2. Los 9 formatos Zyra están seedeados y visibles vía query.
3. El adapter de Seedance 2.0 (fal.ai) genera video real en un smoke test manual (lo corre el
   usuario; los tests automatizados usan mocks — regla del repo).
4. `model_pricing` tiene las filas de Seedance con margen sobre el costo fal.ai.

No hay UI nueva todavía.

## Tareas en orden

### 1. Migración `019_campaigns_v2.sql` (2h)

V1 ya tiene `campaigns` (carpeta ligera workspace-scoped) y `generations.campaign_id` (016).
**Extender, no recrear:**

```sql
alter table campaigns
  add column if not exists goal text,                    -- awareness | conversion | mixed
  add column if not exists market text,
  add column if not exists product_brief jsonb,          -- auto-detección: categoría, variantes, paleta, demográfico
  add column if not exists date_start date,
  add column if not exists date_end date,
  add column if not exists status text default 'draft'
    check (status in ('draft','planned','producing','delivered','archived')),
  add column if not exists credits_estimated integer;

create table campaign_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  format_id uuid references formats(id),
  template_id uuid references creative_templates(id),    -- null si no nace de plantilla
  model_slug text not null,
  duration_s integer,
  aspect_ratio text,
  scene text,
  audio boolean default true,
  character_id uuid references characters(id),
  scene_prompt text not null,
  caption text,                                          -- metadato de publicación, NUNCA texto en pantalla
  scheduled_date date,
  status text default 'planned'
    check (status in ('planned','sample','queued','draft_ready','approved','final_ready','failed','skipped')),
  generation_id uuid references generations(id),
  created_at timestamptz default now()
);
```

Nota de orden: `formats` y `creative_templates` deben crearse antes (misma migración o partirla;
respetar orden de FKs como en 001).

### 2. Migración `020_formats_templates.sql` (2h)

```sql
create table formats (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,                 -- nombre estético (doc V2 §4.2)
  description text,
  register text,                      -- registro narrativo del formato
  camera_style text,
  pacing text,
  required_refs text[],               -- qué exige del Brand Kit: ['product','character','packaging']
  default_duration_s integer,
  default_audio boolean default true,
  is_system boolean default true,
  workspace_id uuid references workspaces(id) on delete cascade  -- null = formato de sistema
);

create table creative_templates (     -- "plantillas vivas" (doc V2 §4.2); distinto de presets V1
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  source_generation_id uuid references generations(id), -- el creativo ganador de origen
  format_id uuid references formats(id),
  fixed_params jsonb not null,        -- estilo, paleta, registro, duración, ratio, model_slug
  slots jsonb not null,               -- producto, variante, escena, personaje
  uses_count integer default 0,
  created_at timestamptz default now()
);

create table scene_library (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('escena','gancho')),
  name text not null,
  prompt_fragment text not null,
  is_system boolean default true,
  workspace_id uuid references workspaces(id) on delete cascade
);
```

### 3. Migración `021_brand_cast_v2.sql` (1h)

Extender lo existente (no tocar columnas actuales):

```sql
alter table brand_kits
  add column if not exists product_image_ids uuid[] default array[]::uuid[],   -- multi-ángulo
  add column if not exists packaging_image_ids uuid[] default array[]::uuid[];

alter table characters
  add column if not exists master_image_id uuid,        -- hoja maestra (frontal, neutra, alta res)
  add column if not exists angle_image_ids uuid[] default array[]::uuid[];     -- perfil, 3/4
```

**Nota — descripción de personaje por visión (2026-06-13):** `characters.description` ya no
depende de que el usuario la teclee. `lib/cast/describe-character.ts` (gemelo de
`analyzeProductBrief`, mismo Gemini Flash) VE la hoja maestra y devuelve la apariencia
age-blind en inglés. Se aplica en dos capas desde `server-actions/cast.ts`:
- **Auto-relleno (red de seguridad):** en `create`/`update`, si `description` viene vacía pero
  hay `master_image_id`, se infiere de la imagen. Best-effort: si el storage o el proveedor
  fallan, se guarda sin descripción y el alta no se bloquea.
- **`describeCharacterAction(masterImageId)`:** sugerencia editable para el form del Cast (botón
  "Describir desde la imagen"), misma UX que el brief del producto.

Reglas duras del inventario (doc V2 §4.3): SOLO lo visible, sin claims inventados; `stripAgeWords`
limpia cualquier marcador de edad que se cuele. Cierra el desperdicio de que el modelo "viera"
las imágenes solo en el matcher: ahora la apariencia llega también a la fidelidad del compiler,
reforzando la línea `@Image` del Cast (guías Morphic §4.1 / RunDiffusion §8).

### 4. Migración `022_rls_v2.sql` (2h)

- Enable RLS en `campaign_items`, `formats`, `creative_templates`, `scene_library`.
- Policies por membresía de workspace (reusar `is_workspace_member`), recordando que INSERT
  necesita `with check`.
- `formats`/`scene_library` de sistema (`workspace_id is null`): SELECT para todos los
  autenticados; INSERT/UPDATE/DELETE solo sobre filas propias del workspace.

### 5. Migración `023_seed_formats.sql` (1.5h)

Seed de los 9 formatos del doc V2 §4.2 con sus campos completos (registro, cámara, ritmo,
required_refs, duración default):

Voz Cercana · A Pie de Calle · Manos a la Obra · El Descubrimiento · Antes y Después ·
Susurro · El Ícono · Gran Pantalla · Mundo Imposible.

Más ~15-20 entradas de `scene_library` (escenas: cocina, baño, calle, gym, auto, estudio…;
ganchos visuales propios — NO copiar nombres de picklists de terceros).

### 6. Migración `024_pricing_seedance.sql` (1h)

Filas en `model_pricing` con margen sobre el costo fal.ai (doc V2 §4.6, costo por segundo):

| slug | costo base | nota |
|---|---|---|
| `seedance-2-fast-480p` | (confirmar en fal.ai al integrar) | draft |
| `seedance-2-fast-720p` | $0.2419/s | iteración |
| `seedance-2-std-720p` | $0.3034/s | render final |
| `seedance-2-std-1080p` | $0.682/s | hero pieces |

Pricing en créditos por segundo (el patrón per-second ya existe: ver 015_kling_per_second).

### 7. Adapter `lib/providers/seedance.ts` (4h)

Sigue el contrato de `lib/providers/types.ts` y el patrón submit/poll de kling.ts/veo.ts:

- Endpoints fal.ai: `bytedance/seedance-2.0/{text-to-video, image-to-video, reference-to-video}`
  y variantes `/fast/`.
- Params: prompt, duration (4–15, entero), aspect_ratio (auto/21:9/16:9/4:3/1:1/3:4/9:16),
  resolution (480p/720p/1080p según tier), generate_audio (default true), seed,
  referencias (hasta 9 imágenes + 3 videos ≤15 s + 3 audios, tope 12 — validar en el adapter).
- Las referencias se pasan como URLs ya subidas (patrón upload-first V1); el output lo descarga
  el worker y lo sube a Storage (regla inmutable: URLs de proveedor nunca al cliente).
- Registro en `lib/jobs/handlers` siguiendo el patrón existente; límites de polling/timeout
  según tabla del spec V1 §6 (estimar: video 15 s puede tardar varios minutos — usar valores
  de Kling como referencia inicial y ajustar con smoke test).
- `seedance.test.ts` con mocks (fixtures de respuestas fal.ai). **Nunca llamar a la API real
  en tests** (regla del repo).

### 8. `docs/modelos/seedance-2.md` (1.5h)

Documento de API specifics siguiendo el formato de los `.md` existentes en `docs/modelos/`:
endpoints, params, límites de entrada (9/3/3, tope 12), sistema de referencias @, estructura
CRAFT resumida, qué falla (manos, texto en pantalla, 3+ sujetos, rostros reales bloqueados),
pricing, y los errores comunes de la guía Morphic (§11) como troubleshooting.

### 9. Schemas zod `lib/schemas/campaigns.ts` (1h)

Schemas para: crear/editar campaña, item de campaña (con validación de duración 4–15,
ratio del enum, caption ≤ límite de plataformas), plantilla viva, formato custom.

## Criterio de cierre

- `pnpm typecheck` y tests verdes.
- Migraciones aplicadas en Supabase sin errores; RLS verificado con un usuario no-miembro.
- Smoke test manual (usuario): un clip Seedance Fast 480p de 4 s desde la consola/script,
  descargado a Storage y visible con URL interna.
