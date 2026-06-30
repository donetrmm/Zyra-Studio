# Diseno: locacion por clip en el storyboard

Fecha: 2026-06-30
Estado: aprobado (pendiente de plan de implementacion)

## Problema

En el storyboard, la locacion se asigna solo a nivel **creativo** (toda la
secuencia): un unico selector escribe `location_id` en todos los beats del
creativo. No se puede fijar una locacion distinta por clip, asi que no se pueden
montar escenas en lugares diferentes dentro del mismo creativo (p.ej. un beat en
"Cuarto Lowkey" y otro en "Jardin").

## Estado actual (lo que YA existe)

- **Modelo:** `campaign_items.location_id` es por item (cada beat tiene el suyo).
- **Accion:** `setStoryboardLocationAction(campaignId, locationId, { sequenceId,
  itemId })` (`server-actions/storyboard.ts`) ya soporta ambos alcances: con
  `sequenceId` actualiza toda la secuencia; con `sequenceId: null` actualiza solo
  `itemId`. No requiere cambios.
- **UI:** `StoryboardView.tsx` solo renderiza el selector a nivel creativo
  (`handleSetLocation` llama con `sequenceId: selectedCreative.sequenceId`).
  `StoryboardBeat` ya carga `locationId`; `locations: { id; name }[]` ya es prop.

El cambio es **solo UI**. Sin migracion, sin accion nueva, sin tocar el backend.

## Decision

Agregar un selector de locacion **por clip** en cada tarjeta de beat, y mantener
el selector a nivel creativo como atajo explicito "aplica a todos".

## Cambios (todos en `components/campaigns/StoryboardView.tsx`)

### 1. Selector por clip

Dentro del render de cada beat (`visibleBeats.map`), un `<select>` compacto:

- Valor = `beat.locationId ?? ''`.
- Opciones = `<option value="">Sin locacion</option>` + `locations.map`.
- `onChange` -> `handleSetBeatLocation(beat.id, value === '' ? null : value)`.
- Deshabilitado mientras `savingBeatLocation === beat.id`.

Nuevo handler `handleSetBeatLocation(itemId, locationId)`:

- Marca `savingBeatLocation = itemId`.
- Llama `setStoryboardLocationAction(campaignId, locationId, { sequenceId: null,
  itemId })`.
- En exito: `router.refresh()` (re-renderiza con el nuevo `beat.locationId`) y
  toast `locationId ? 'Locacion del clip actualizada' : 'Locacion del clip quitada'`.
- En error: `toast.error(friendlyError(res.error, res.message))`.
- `finally`: `savingBeatLocation = null`.

Nuevo estado: `const [savingBeatLocation, setSavingBeatLocation] = useState<string | null>(null)`.

### 2. Selector general -> "aplica a todos"

Se mantiene el selector y `handleSetLocation` existentes (escriben toda la
secuencia con `sequenceId: selectedCreative.sequenceId`). Solo cambia el copy:

- Label: **"Locacion base (aplica a todos los clips)"**.
- Nota: "siembra todos; ajusta cada clip abajo".

Sigue mostrando `currentLocationId` (primer beat con locacion) como valor base.

### 3. Nota de aplicar

El cambio de locacion no se ve hasta **regenerar** el panel. La nota existente
bajo el selector general ("ancla el lugar en cada panel; regenera para aplicarla")
ya lo comunica para todo el storyboard. **No** se agrega una nota por tarjeta
(evita ruido visual): el selector por clip no lleva texto extra; la nota general
cubre ambos niveles.

## Manejo de errores

`toast.error(friendlyError(res.error, res.message))`, mismo patron que
`handleRegenerate`/`handleRefine`. El guard existente `locations.length > 0`
sigue aplicando: sin locaciones, ningun selector se muestra (ni el general ni el
por clip).

## Flujo de datos

select (clip) -> `handleSetBeatLocation` -> `setStoryboardLocationAction`
(scope item) -> update `campaign_items.location_id` -> `revalidatePath` (en la
accion) + `router.refresh()` -> beats re-renderizan con el nuevo `locationId`.
La locacion se APLICA visualmente al regenerar el panel (no automaticamente).

## Trade-off declarado

Con locaciones por clip distintas, el selector general muestra la del primer clip
y, al cambiarlo, **sobrescribe todas** las del creativo. Es su rol intencional
("aplica a todos"); no es un bug.

## Testing

Cambio presentacional en un client component. Verificacion = `pnpm typecheck` +
`pnpm build`. La accion de backend no cambia (ya cubierta por sus tests/uso).
Sin APIs reales. No se agrega test unitario de UI (no hay logica pura nueva mas
alla del handler, que es IO sobre una accion ya existente).

## Fuera de alcance

- Aplicar la locacion sin regenerar (sigue requiriendo regeneracion del panel).
- Cualquier cambio al backend, modelo o migracion.
- Locacion por clip en el VIDEO directamente (el video hereda del panel/beat ya
  por item; no se toca aqui).

## Constraints

Sin emojis (UI). No `any`. pnpm. Commits sin `Co-Authored-By`. Sin BOM. Dark mode
+ acento `#009fff`. Componentes existentes/shadcn. `'use server'` no se toca (la
accion ya existe). Garantia: el selector general conserva su comportamiento
actual; solo se agrega el por clip.
