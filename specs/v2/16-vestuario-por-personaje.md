# Fase P — Vestuario por personaje (cuerpo completo + outfits intercambiables)

> **~1.5–2 días · migración 059 + editor Cast + threading a generación + selección**
>
> La hoja maestra del Cast es un retrato head-and-shoulders por diseño (`asset-prompts.ts:49`):
> del pecho para abajo no hay nada anclado y cada panel/clip inventa la ropa — el drift de
> vestuario que se vio generando los paneles del storyboard (2026-07-06). Se agrega al
> personaje una imagen de **cuerpo completo** (ancla de ropa y proporciones) y **outfits
> intercambiables** (variantes de cuerpo completo con label), elegidos por campaña con
> override por clip. Diseño validado el 2026-07-06.

## Contexto y decisión de diseño central

- La **maestra sigue siendo el ancla de identidad** (cara grande y nítida). El cuerpo
  completo NO la reemplaza: viaja como referencia adicional en un slot propio.
- **`character_states` queda intacto** (P05: condición física — sudado/mojado — swapea la
  maestra). Los outfits son ortogonales: swapean el **cuerpo completo**. Pueden convivir
  en el mismo clip (cara sudada + ropa deportiva).
- La resolución del outfit es **explícita del usuario** (campaña + override por clip). El
  matcher NO decide ropa — la continuidad de vestuario es exactamente lo que un LLM
  estocástico rompería.
- **Límite honesto:** el cuerpo completo reduce el drift, no lo elimina — FLUX/Seedance
  siguen siendo estocásticos y los detalles finos (estampados) pueden variar. Es anclaje,
  no garantía.

## Objetivo

Al cerrar la fase: un personaje puede tener cuerpo completo base (subido o generado desde
la maestra) y N outfits con label (subidos o generados editando el cuerpo completo). En el
wizard se elige el outfit de cada personaje para toda la campaña; el editor del clip permite
override puntual. La imagen de cuerpo completo (base u outfit elegido) llega como referencia
de personaje a los tres caminos de generación — paneles de storyboard (donde nace el drift),
video R2V y compile normal — con una cita que ordena conservar esa ropa exacta.

## Modelo de datos (migración 059, aplicar vía MCP ANTES del push)

```sql
-- Cuerpo completo base del personaje (vestuario por defecto).
alter table characters
  add column if not exists full_body_image_id uuid references media_references(id) on delete set null;

-- Outfits: variantes de cuerpo completo con label. Espejo de character_states (045).
create table character_outfits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  character_id uuid not null references characters(id) on delete cascade,
  label text not null,
  outfit_image_id uuid references media_references(id) on delete set null,
  description text,
  created_at timestamptz not null default now()
);
-- + índice por character_id y las 4 RLS member-scoped (mismo patrón que 045).

-- Outfit elegido por personaje para TODA la campaña: { [characterId]: outfitId }.
alter table campaigns
  add column if not exists character_outfit_map jsonb;

-- Override por clip, por LABEL (mismo patrón que character_state_hint). null = el de campaña.
alter table campaign_items
  add column if not exists character_outfit_hint text;
```

## Resolución en generación

Por personaje del clip, en `directorContextFor` (`lib/campaigns/orchestrator.ts`):

```
outfit del clip (character_outfit_hint, por label)
  → outfit de campaña (character_outfit_map[characterId])
  → characters.full_body_image_id (base)
  → sin cuerpo completo (comportamiento actual, sin regresión)
```

- `CampaignContext.characters` gana `fullBodyImagePath?` y `outfits?: Record<label, path>`
  (misma carga/resolución de paths que `states`). `loadCampaignContext` lee el map de la
  campaña y las filas de `character_outfits`.
- `CharacterInventory` (`lib/prompt-director/types.ts`) gana `fullBodyImagePath?: string`.
- El compiler (seedance `buildReferences` + ensamblado de paneles) empuja el cuerpo completo
  como referencia rol `character` **justo después de la maestra**, con cita propia de
  vestuario: la ropa de esa imagen se conserva idéntica en todas las tomas del clip.
- **Llega a los tres caminos sin cableado por-camino:** los paneles del storyboard filtran
  rol `character` (`storyboard.ts:194`) y el R2V arma castRefs de las refs de personaje —
  al entrar por el inventario del compiler, fluye a todos.
- **Presupuesto de refs (tope global 9):** prioridad maestra > cuerpo completo > ángulos.
  Con refs apretadas se recorta un ángulo antes que el vestuario (ajuste en el presupuesto
  automático del compiler; la selección manual del usuario no se re-recorta, como hoy).

## Creación de imágenes (editor del Cast)

- **Cuerpo completo base:** subir foto O generar con Nano Banana desde la maestra —
  misma mecánica multi-turn que los ángulos de consistencia (identidad intacta): "misma
  persona, de pie, cuerpo completo, pose neutra", con el `portraitSetting` del estilo.
- **Outfits:** sección tipo estados en el editor del personaje — label + imagen. Se crea
  subiendo O generando (Nano Banana edita el cuerpo completo base: "misma persona, misma
  pose, ahora viste X"). Sin cuerpo completo base no se pueden generar outfits (sí subir).
- Costo en créditos visible por acción (patrón `fluxCost` existente). Las imágenes quedan
  como `media_references` (necesario para usarlas como refs).

## Selección

- **Wizard de campaña:** al seleccionar personajes, si el personaje tiene outfits aparece un
  dropdown ("Vestuario: base / <labels>") → persiste en `character_outfit_map`. Default:
  cuerpo completo base.
- **Editor del clip** (studio-item): dropdown de override con los labels de outfits de los
  personajes del clip → `character_outfit_hint`. null = el de campaña.
- El matcher y el planner NO se tocan.

## Errores y guardas

- Personaje sin cuerpo completo: todo funciona como hoy (cero regresión); el editor invita a
  crearlo ("ancla el vestuario para que no cambie entre clips").
- Outfit borrado después de elegido en una campaña: la resolución cae al siguiente nivel
  (base) sin romper la generación; el editor del clip muestra el hint huérfano como aviso.
- Ownership: server actions validan workspace en `character_outfits` y en el map (zod +
  verificación contra el pool), RLS como última línea.
- Nano Banana safety reject: mensaje claro, permitir reescribir (patrón CreationWizard).

## Criterio de cierre

- `pnpm typecheck`, `pnpm build` y tests verdes (resolución de outfit pura, compiler cita el
  cuerpo completo tras la maestra, presupuesto con prioridad, hint huérfano cae a base).
- Un personaje con cuerpo completo + 2 outfits: el wizard permite elegir uno por campaña; un
  clip con override usa el del override; los paneles del storyboard reciben la imagen de
  vestuario como ref y la citan.
- `character_states` sigue funcionando igual (tests P05 intactos).
- Smoke manual (usuario, API real): regenerar los paneles del storyboard que drifteaban con
  el cuerpo completo cargado y comparar consistencia de ropa.
