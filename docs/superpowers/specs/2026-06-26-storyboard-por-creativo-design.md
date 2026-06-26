# Storyboard por creativo — diseño

**Fecha:** 2026-06-26
**Estado:** aprobado (alcance "completo" elegido por el usuario)

## Problema

La pantalla de Storyboard (`/app/campaigns/[id]/storyboard`) carga **todos** los `campaign_items`
de la campaña en una lista plana ordenada por `scene_index`, sin distinguir a qué **creativo**
pertenecen. Cuando una campaña tiene más de un creativo, los beats se mezclan (y como `scene_index`
es 0..N-1 *por secuencia*, dos secuencias se entrelazan). El usuario pidió un select para elegir
de qué creativo está haciendo el storyboard.

Al revisar se detectaron dos problemas latentes que la mezcla destapa:

1. **Encadenado cruza creativos.** `loadPreviousPanelTurn` busca el "panel anterior" por
   `scene_index` en toda la campaña, sin filtrar `sequence_id` → la escena de una secuencia se
   encadenaría con la de otra.
2. **Locación campaign-wide.** `setStoryboardLocationAction` escribe `location_id` a todos los
   items de la campaña, sin scope por creativo.

## Modelo de "creativo"

Un creativo = un `campaign_item` independiente (`sequence_id` null) **o** una secuencia (varios
items con el mismo `sequence_id`, ordenados por `scene_index`, con `sequence_label`).

- **clave del creativo** = `sequence_id ?? item.id`
- **label**: secuencia → `sequence_label` (fallback "Secuencia"); suelto → nombre del formato
  (fallback "Creativo"). Si dos creativos quedan con el mismo label, se desambigua con sufijo
  numérico 1-based (`"Reel 1"`, `"Reel 2"`).
- **orden de beats** dentro del creativo: por `scene_index` (suelto = 0).
- **orden de creativos** en el select: por el `created_at` más temprano de sus beats.

## Cambios

1. **`lib/campaigns/storyboard-creatives.ts`** (nuevo, puro + unit test): `buildCreatives(rows)`
   agrupa las filas en `StoryboardCreative[]` ordenados, con labels deduplicados.
2. **`lib/campaigns/storyboard-types.ts`**: `StoryboardBeat` gana `locationId: string | null`;
   nuevo `StoryboardCreative`.
3. **`page.tsx`**: la query trae `sequence_id, sequence_label, format_id, created_at, location_id`
   y resuelve nombres de formato (join `formats`); construye `beats` (con `locationId`) y
   `creatives`, los pasa al view.
4. **`StoryboardView.tsx`**: estado `selectedCreativeKey` (default: primer creativo); `visibleBeats`
   filtrados al creativo; un `<select>` de creativo visible **solo cuando hay >1**; el contador de
   escenas, "Generar storyboard" (withoutPanel) y el control de locación operan sobre el creativo
   seleccionado. La locación mostrada es la del creativo (primer `locationId` no nulo de sus beats).
5. **`server-actions/storyboard.ts`**:
   - `loadPreviousPanelTurn(..., sequenceId)`: guard `sceneIndex == null || sequenceId == null` →
     null; añade `.eq('sequence_id', sequenceId)`. `generatePanelAction` le pasa `item.sequence_id`.
   - `setStoryboardLocationAction(campaignId, locationId, creative)` con
     `creative: { sequenceId: string | null; itemId: string }`: ancla la locación por
     `sequence_id` (secuencia) o por `id` (suelto). Único caller: `StoryboardView`.

## Compatibilidad

Con **un solo creativo** (caso de hoy) el comportamiento se preserva: el select se oculta, la
locación scoped a ese único creativo equivale a "toda la campaña", y el encadenado scoped a la
única secuencia equivale al de antes. Sin migraciones (solo lectura de columnas ya existentes).

## Fuera de alcance

Persistir el creativo seleccionado entre recargas; reordenar creativos manualmente.
