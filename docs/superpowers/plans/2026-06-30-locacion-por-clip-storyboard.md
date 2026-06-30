# Locacion por clip en el storyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir asignar la locacion de cada clip por separado en el storyboard, manteniendo el selector a nivel creativo como atajo "aplica a todos".

**Architecture:** Cambio solo de UI en `components/campaigns/StoryboardView.tsx`. El backend (`setStoryboardLocationAction(campaignId, locationId, { sequenceId, itemId })`) y el modelo (`campaign_items.location_id` por item) ya soportan el alcance por item: con `sequenceId: null` actualiza solo `itemId`. Se agrega un selector por tarjeta de beat y se re-etiqueta el selector general.

**Tech Stack:** Next.js 15 client component, React 19, TypeScript estricto, sonner (toasts), lucide-react (MapPin), Tailwind v4.

## Global Constraints

- Sin emojis en UI. No `any`. pnpm (`pnpm typecheck`, `pnpm build`). Commits SIN `Co-Authored-By`. Sin BOM. Dark mode + acento `#009fff`. Sin migracion, sin accion nueva, sin tocar el backend. El selector general conserva su comportamiento actual (solo cambia el copy). Garantia: con locaciones todas iguales, el comportamiento percibido no cambia.
- Spec fuente: `docs/superpowers/specs/2026-06-30-locacion-por-clip-storyboard-design.md`.

---

### Task 1: Selector de locacion por clip + re-etiquetar el general

**Files:**
- Modify: `components/campaigns/StoryboardView.tsx`

**Interfaces:**
- Consumes (ya existen en el archivo): `setStoryboardLocationAction(campaignId, locationId, { sequenceId, itemId })`, `friendlyError(error, message?)`, `useRouter().refresh()`, `toast`, `MapPin`, el prop `locations: { id: string; name: string }[]`, y `StoryboardBeat` (tiene `id`, `locationId`, `sceneIndex`).
- Produces: el handler `handleSetBeatLocation(itemId: string, locationId: string | null): Promise<void>` y el estado `savingBeatLocation: string | null`.

Esta task es presentacional (client component, IO sobre una accion ya existente). No hay logica pura nueva que testear con vitest; la verificacion es `pnpm typecheck` + `pnpm build`.

- [ ] **Step 1: Agregar el estado `savingBeatLocation`**

En `components/campaigns/StoryboardView.tsx`, junto a `const [savingLocation, setSavingLocation] = useState(false);` (linea ~46), agregar:

```tsx
  const [savingBeatLocation, setSavingBeatLocation] = useState<string | null>(null);
```

- [ ] **Step 2: Agregar el handler `handleSetBeatLocation`**

Justo despues de la funcion `handleSetLocation` (termina alrededor de la linea ~78, despues de su bloque `else { ... }`), agregar:

```tsx
  // Locacion de UN clip (item): scope por item (sequenceId null). El general (handleSetLocation)
  // escribe toda la secuencia; este sobrescribe solo este beat. La locacion se aplica al regenerar.
  async function handleSetBeatLocation(itemId: string, locationId: string | null) {
    setSavingBeatLocation(itemId);
    const res = await setStoryboardLocationAction(campaignId, locationId, {
      sequenceId: null,
      itemId,
    });
    setSavingBeatLocation(null);
    if (res.ok) {
      toast.success(locationId ? 'Locación del clip actualizada' : 'Locación del clip quitada');
      router.refresh();
    } else {
      toast.error(friendlyError(res.error, res.message));
    }
  }
```

- [ ] **Step 3: Re-etiquetar el selector general como "aplica a todos"**

En el bloque del selector a nivel creativo (lineas ~293-317), cambiar SOLO el copy del label y la nota.

Cambiar el label (linea ~296-298) de:

```tsx
          <label htmlFor="storyboard-location" className="text-[12px] text-muted-foreground">
            Locación de la escena:
          </label>
```

a:

```tsx
          <label htmlFor="storyboard-location" className="text-[12px] text-muted-foreground">
            Locación base (aplica a todos los clips):
          </label>
```

Cambiar la nota (linea ~313-315) de:

```tsx
          <span className="text-[11px] text-muted-foreground">
            ancla el lugar en cada panel; regenera para aplicarla
          </span>
```

a:

```tsx
          <span className="text-[11px] text-muted-foreground">
            siembra todos los clips; ajusta cada uno abajo. Regenera para aplicarla.
          </span>
```

- [ ] **Step 4: Agregar el selector por clip en la tarjeta del beat**

En el render de cada beat, entre el bloque `{/* Prompt preview */}` (termina linea ~375) y el bloque `{/* Regenerar */}` (empieza linea ~377), insertar el selector por clip. Se gatea con `locations.length > 0` (igual que el general) y se deshabilita mientras guarda ese beat o mientras hay generacion/refinado en curso:

```tsx
                {/* Locación de este clip (override por item; el general siembra todos) */}
                {locations.length > 0 && (
                  <div className="flex items-center gap-1.5 px-0.5">
                    <MapPin className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                    <label htmlFor={`loc-${beat.id}`} className="sr-only">
                      Locación del clip {beat.sceneIndex + 1}
                    </label>
                    <select
                      id={`loc-${beat.id}`}
                      value={beat.locationId ?? ''}
                      disabled={savingBeatLocation === beat.id || isGenerating || isRefining || generatingAll}
                      onChange={(e) =>
                        void handleSetBeatLocation(beat.id, e.target.value === '' ? null : e.target.value)
                      }
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                    >
                      <option value="">Sin locación</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
```

Nota de contexto para el implementador: dentro de ese `map`, `isGenerating`, `isRefining` y `generatingAll` ya estan en scope (se calculan/usan en el mismo render del beat, p.ej. en el boton "Regenerar" y los switches). `beat.locationId`, `beat.id` y `beat.sceneIndex` son campos de `StoryboardBeat`.

- [ ] **Step 5: Verificar typecheck y build**

Run: `pnpm typecheck`
Expected: sin errores.

Run: `pnpm build`
Expected: "Compiled successfully".

- [ ] **Step 6: Commit**

```bash
git add components/campaigns/StoryboardView.tsx
git commit -m "feat(storyboard): locacion por clip (selector por beat) + general como aplica-a-todos"
```

---

## Self-Review (controlador)

- **Spec coverage:** selector por clip (Step 4 + handler Step 2 + estado Step 1) ✅; general re-etiquetado "aplica a todos" (Step 3) ✅; sin nota por tarjeta (no se agrega; la nota general cubre ambos) ✅; manejo de error con `friendlyError` ✅; guard `locations.length > 0` ✅; verificacion typecheck+build ✅. Sin migracion / sin accion nueva ✅.
- **Sin placeholders:** todos los pasos llevan el codigo exacto.
- **Consistencia de tipos:** `handleSetBeatLocation(itemId: string, locationId: string | null)`; `savingBeatLocation: string | null`; `setStoryboardLocationAction(campaignId, locationId, { sequenceId: null, itemId })` coincide con la firma existente.
