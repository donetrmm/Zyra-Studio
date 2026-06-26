# Reprocesar idea con IA (campaña existente) — diseño

**Fecha:** 2026-06-26
**Estado:** aprobado

## Problema

Cuando una campaña se genera sin idea (o el matcher de Gemini falla), `generatePlanAction`
cae al **mix por categoría** (`buildPlan`) con prompts de **semilla** genéricos (sin diálogo,
tipo plantilla). Hoy `generatePlanAction` (que corre el matcher → plan dirigido) **solo se
invoca desde el wizard de campaña nueva**; en una campaña existente no hay forma de volver a
correr la interpretación de la idea. El usuario quiere un botón para **reprocesar la idea** y que
Gemini la interprete y entregue el creativo real, en vez de caer a plantillas.

## Lo que ya existe (no rehacer)

`generatePlanAction({ campaignId, userIdeas })`:
- Corre el matcher (`matchIdeas`, Gemini) → `buildDirectedPlan` cuando hay idea.
- **Re-planifica**: borra los items con status `planned`/`skipped` e inserta el plan nuevo;
  los items ya generados (`done`/`processing`/etc.) se conservan.
- Devuelve `source: 'ideas' | 'mix'`, `matcherError`, `inventedNames`, `blockers`.

Decisión (usuario): **conservar lo generado, reemplazar solo borradores** = comportamiento actual.
No se cambia el backend del re-plan.

## Cambios

1. **Migración `048_campaign_idea_text.sql`**: `alter table campaigns add column if not exists
   idea_text text;` (aditiva, nullable).
2. **Persistir la idea** (decisión usuario): en `generatePlanAction`, al actualizar la campaña al
   final, guardar `idea_text = userIdeas` cuando viene `userIdeas` (cubre wizard y reprocesar; no
   se sobrescribe con null si no hay idea). Así el botón puede pre-llenar la idea.
3. **`lib/campaigns/matcher-hints.ts`** (nuevo): extraer `MATCHER_ERROR_HINTS` (hoy local en el
   wizard) para reusarlo en el diálogo de reprocesar. El wizard lo importa de ahí (DRY).
4. **`app/app/campaigns/[id]/page.tsx`**: la query de `campaigns` trae `idea_text`; se pasa como
   `ideaText` en el prop `campaign` de `CampaignStudioView`.
5. **`CampaignStudioView`**: el prop `campaign` gana `ideaText: string | null`. Un botón
   **"Reprocesar idea con IA"** en el header abre un diálogo (shadcn `Dialog`) con un `textarea`
   pre-llenado con `ideaText`. Al enviar: `generatePlanAction({ campaignId, userIdeas })`, luego:
   - `source:'ideas'` → toast de éxito + `router.refresh()` (el plan genérico se reemplaza por el
     dirigido).
   - `source:'mix'` → toast.warning con el motivo (`MATCHER_ERROR_HINTS[matcherError]`), no se
     degrada en silencio. También se surfacean `inventedNames` y `blockers` (mismo patrón que el
     wizard).
   - Nota en el diálogo: "Reemplaza los creativos en borrador con el plan que la IA interprete de
     tu idea. Los que ya generaste se conservan."
   - El textarea exige idea no vacía (sin idea no tiene sentido reprocesar).

## Orden de despliegue

La migración 048 añade una columna que la página del Studio leerá (`idea_text`). Se aplica a la BD
**antes** de pushear el código (regla: prod sigue development y las migraciones no se auto-aplican;
leer una columna inexistente da 500).

## Fuera de alcance

Reprocesar por-creativo (solo uno); ajustar `totalItems` desde el diálogo (con idea, el matcher
decide la cantidad); historial de ideas.
