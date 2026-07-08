# Toggle de audio inteligente en el wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la sección de audio del wizard de campañas detecte si los personajes seleccionados tienen voz y recomiende la opción correcta con feedback claro, sin ocultar opciones ni pisar la elección manual.

**Architecture:** Un helper puro `recommendedAudioSource` (en `lib/campaigns/sequence-chain.ts`, ya es el módulo de lógica pura del encadenado) decide `'prev_clip'` vs `'music'` según si algún personaje seleccionado tiene voz. La page pasa `hasVoice` por personaje. El wizard deriva un `effectiveAudioSource` (recomendación salvo override manual), lo usa para el radio, el badge, el copy y el submit. Sin cambios de backend/generación.

**Tech Stack:** Next.js 15 (App Router, Server Component en la page), React client component (wizard), Supabase (query en la page), vitest (test del helper puro).

## Global Constraints

- Sin emojis en UI ni en código; sistema visual minimalista.
- No `any` en TypeScript: usar tipos explícitos.
- Tests sin APIs reales (el helper es puro; no se testean queries a Supabase).
- Commits sin trailer `Co-Authored-By`.
- `pnpm typecheck` y `pnpm build` obligatorios antes de cerrar (build por el gotcha de compilación del repo).
- El valor enviado sigue siendo `chainAudioSource: 'music' | 'prev_clip'`; no cambia el schema de la action ni la generación.
- Un personaje "tiene voz utilizable en video" = `voice_clone_id != null` **y** su `voice_clones.sample_storage_url != null`.

---

### Task 1: Helper puro `recommendedAudioSource`

**Files:**
- Modify: `lib/campaigns/sequence-chain.ts` (añadir función al final; ya exporta `ChainAudioSource`)
- Test: `lib/campaigns/sequence-chain.test.ts` (añadir describe)

**Interfaces:**
- Consumes: el tipo `ChainAudioSource` (`'music' | 'prev_clip'`) ya definido en `sequence-chain.ts`.
- Produces: `recommendedAudioSource(selectedIds: string[], chars: Array<{ id: string; hasVoice: boolean }>): ChainAudioSource` — usado por el wizard en Task 3.

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `lib/campaigns/sequence-chain.test.ts`. Verificar primero que el import del archivo incluya `recommendedAudioSource` (agregarlo al import existente desde `'./sequence-chain'`).

```ts
describe('recommendedAudioSource', () => {
  const chars = [
    { id: 'a', hasVoice: true },
    { id: 'b', hasVoice: false },
  ];
  it('sin selección → music', () => {
    expect(recommendedAudioSource([], chars)).toBe('music');
  });
  it('seleccionado sin voz → music', () => {
    expect(recommendedAudioSource(['b'], chars)).toBe('music');
  });
  it('seleccionado con voz → prev_clip', () => {
    expect(recommendedAudioSource(['a'], chars)).toBe('prev_clip');
  });
  it('mezcla (uno con voz) → prev_clip', () => {
    expect(recommendedAudioSource(['a', 'b'], chars)).toBe('prev_clip');
  });
  it('id seleccionado que no está en chars → music (no crashea)', () => {
    expect(recommendedAudioSource(['zzz'], chars)).toBe('music');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm exec vitest run lib/campaigns/sequence-chain.test.ts`
Expected: FAIL — `recommendedAudioSource is not a function` / import no resuelto.

- [ ] **Step 3: Implementar el helper**

Añadir al final de `lib/campaigns/sequence-chain.ts`:

```ts
// Recomendación de fuente de audio para el toggle del wizard: si algún personaje
// seleccionado tiene voz asignada (utilizable en video), 'prev_clip' propaga ese
// timbre a los clips 2..N de una secuencia encadenada (el clip 1 usa la voz, pero
// los siguientes no la re-citan). Si ninguno tiene voz, la pista marca el ritmo.
// Pura (sin DB): la consume el wizard para el default sugerido y el badge.
export function recommendedAudioSource(
  selectedIds: string[],
  chars: Array<{ id: string; hasVoice: boolean }>,
): ChainAudioSource {
  const voiced = new Set(chars.filter((c) => c.hasVoice).map((c) => c.id));
  return selectedIds.some((id) => voiced.has(id)) ? 'prev_clip' : 'music';
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm exec vitest run lib/campaigns/sequence-chain.test.ts`
Expected: PASS (todos los describe del archivo, incluido el nuevo).

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/sequence-chain.ts lib/campaigns/sequence-chain.test.ts
git commit -m "feat(campaigns): helper recommendedAudioSource para el toggle de audio"
```

---

### Task 2: Data flow — `hasVoice` por personaje en la page

**Files:**
- Modify: `app/app/campaigns/new/page.tsx` (query de `characters` y armado del prop)

**Interfaces:**
- Produces: el prop `characters` del `CampaignStudioWizard` gana el campo `hasVoice: boolean` (consumido en Task 3).
- Consumes: tabla `characters` (`voice_clone_id`) y `voice_clones` (`id, sample_storage_url`).

- [ ] **Step 1: Añadir `voice_clone_id` al select de characters**

En `app/app/campaigns/new/page.tsx`, cambiar el select del query de `characters`:

```ts
    supabase
      .from('characters')
      .select('id, name, master_image_id, angle_image_ids, reference_image_ids, voice_clone_id')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false }),
```

- [ ] **Step 2: Propagar `voiceCloneId` en `usable`**

Cambiar el `.map` de `usable`:

```ts
  const usable = (characterRows ?? [])
    .map((c) => ({
      id: c.id as string,
      name: c.name as string,
      masterId: (c.master_image_id as string | null) ?? ((c.reference_image_ids as string[]) ?? [])[0] ?? null,
      angleCount: ((c.angle_image_ids as string[]) ?? []).length,
      voiceCloneId: (c.voice_clone_id as string | null) ?? null,
    }))
    .filter((c) => c.masterId);
```

- [ ] **Step 3: Resolver qué voces tienen muestra utilizable**

Insertar ANTES de `const characters = usable.map(...)` (después del bloque de `previews`):

```ts
  // Voz utilizable en video: la ficha tiene voice_clone_id Y ese clon tiene muestra
  // (sample_storage_url) — solo entonces sirve como @audio1 de timbre. Alimenta la
  // recomendación del toggle de audio del wizard.
  const voiceCloneIds = [
    ...new Set(usable.map((c) => c.voiceCloneId).filter((v): v is string => !!v)),
  ];
  const voicesWithSample = new Set<string>();
  if (voiceCloneIds.length) {
    const { data: clones } = await supabase
      .from('voice_clones')
      .select('id, sample_storage_url')
      .in('id', voiceCloneIds);
    for (const v of clones ?? []) {
      if (v.sample_storage_url) voicesWithSample.add(v.id as string);
    }
  }
```

- [ ] **Step 4: Añadir `hasVoice` al prop `characters`**

Cambiar el `.map` final de `characters`:

```ts
  const characters = usable.map((c) => ({
    id: c.id,
    name: c.name,
    previewUrl: c.masterId ? (previews[c.masterId] ?? null) : null,
    angleCount: c.angleCount,
    hasVoice: c.voiceCloneId ? voicesWithSample.has(c.voiceCloneId) : false,
  }));
```

- [ ] **Step 5: Verificar typecheck (debe PASAR)**

Run: `pnpm typecheck`
Expected: PASS. `page.tsx` pasa a `<CampaignStudioWizard characters={characters} .../>` una **variable** con un campo extra `hasVoice`; TS permite asignar una variable con props de más a un prop tipado sin ellas (el excess-property-check solo aplica a object literals inline), así que el wizard simplemente ignora `hasVoice` hasta Task 3. El commit queda verde.

- [ ] **Step 6: Commit**

```bash
git add app/app/campaigns/new/page.tsx
git commit -m "feat(campaigns): la page resuelve hasVoice por personaje para el wizard"
```

---

### Task 3: Wiring del wizard (prop, effectiveAudioSource, badge, copy, submit)

**Files:**
- Modify: `components/campaigns/CampaignStudioWizard.tsx` (tipo del prop, import, estado, derivación, sección de audio, submit)

**Interfaces:**
- Consumes: `recommendedAudioSource` (Task 1) y el campo `hasVoice` del prop `characters` (Task 2).
- Produces: envía `chainAudioSource: effectiveAudioSource` al `createCampaignStudioAction` (mismo tipo que antes).

- [ ] **Step 1: Importar el helper**

En `components/campaigns/CampaignStudioWizard.tsx`, junto a los imports de `@/lib/campaigns/...` (ej. tras la línea de `matcher-hints`), añadir:

```ts
import { recommendedAudioSource } from '@/lib/campaigns/sequence-chain';
```

- [ ] **Step 2: Extender el tipo del prop `characters`**

Cambiar la firma del prop (donde hoy dice `characters: Array<{ id: string; name: string; previewUrl: string | null; angleCount: number }>;`):

```ts
  characters: Array<{
    id: string;
    name: string;
    previewUrl: string | null;
    angleCount: number;
    hasVoice: boolean;
  }>;
```

- [ ] **Step 3: Añadir el flag de override manual**

Justo debajo de `const [chainAudioSource, setChainAudioSource] = useState<'music' | 'prev_clip'>('music');` añadir:

```ts
  // El usuario tocó el toggle manualmente: si no, el valor sigue la recomendación
  // (según si el personaje seleccionado tiene voz). Evita pisar una elección explícita.
  const [audioSourceTouched, setAudioSourceTouched] = useState(false);
```

- [ ] **Step 4: Derivar recomendación, efectivo y copy (antes del `return`)**

Añadir cerca del resto de derivaciones del componente (antes del JSX, junto a `canSubmit`):

```ts
  const recommendedSource = recommendedAudioSource(selectedCharacterIds, characters);
  const effectiveAudioSource = audioSourceTouched ? chainAudioSource : recommendedSource;
  const anySelectedHasVoice = selectedCharacterIds.some(
    (id) => characters.find((c) => c.id === id)?.hasVoice,
  );
  const audioHint =
    selectedCharacterIds.length === 0
      ? 'Sin personaje que hable; la pista marca el ritmo.'
      : anySelectedHasVoice
        ? "Tu personaje tiene voz asignada. En una secuencia encadenada, 'Voz del clip anterior' mantiene ese timbre en los clips siguientes; con 'Pista musical' la voz podría cambiar."
        : "Ningún personaje seleccionado tiene voz asignada. 'Pista musical' marca el ritmo y el modelo genera la voz.";
```

- [ ] **Step 5: Reescribir la sección de audio (nota intro + radiogroup + copy + badge)**

Dentro de la `<section>` cuyo `<span>` dice "Audio de referencia en anuncios de varias escenas", **conservar ese `<span>` título** y reemplazar TODO lo que le sigue dentro de la sección — es decir: el `<p>` intro actual ("Solo puede viajar una referencia de audio por clip (límite de 15s). Elige qué guía…"), el `<div role="radiogroup">` y el `<p>` de copy dinámico final — por este bloque (evita dejar el párrafo intro viejo, que sería redundante con la nota de alcance):

```tsx
                <p className="text-2xs text-muted-foreground">
                  Solo puede viajar una referencia de audio por clip (15s máx), y esto solo aplica
                  a secuencias de varias escenas encadenadas. En modo Locación o en un solo clip,
                  la voz del personaje ya se usa en cada clip.
                </p>
                <div className="flex gap-2" role="radiogroup" aria-label="Audio de los clips encadenados">
                  {(
                    [
                      { value: 'music', label: 'Pista musical', hint: 'El ritmo de la pista guía cada clip' },
                      { value: 'prev_clip', label: 'Voz del clip anterior', hint: 'Cada clip hereda el audio del anterior: misma voz y ambiente' },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={effectiveAudioSource === o.value}
                      title={o.hint}
                      onClick={() => {
                        setAudioSourceTouched(true);
                        setChainAudioSource(o.value);
                      }}
                      className={`flex-1 rounded-lg border px-3 py-2 text-2sm transition-colors ${
                        effectiveAudioSource === o.value
                          ? 'border-primary/60 bg-primary/10 text-foreground'
                          : 'border-border bg-card text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {o.label}
                      {recommendedSource === o.value && (
                        <span className="ml-1.5 text-2xs text-primary">Recomendado</span>
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-2xs text-muted-foreground">{audioHint}</p>
```

- [ ] **Step 6: Enviar `effectiveAudioSource` en el submit**

En `runCreate`, cambiar `chainAudioSource,` (la línea suelta del payload a `createCampaignStudioAction`) por:

```ts
      chainAudioSource: effectiveAudioSource,
```

- [ ] **Step 7: Typecheck y build**

Run: `pnpm typecheck`
Expected: PASS (ya no hay error del prop; `effectiveAudioSource` es `'music' | 'prev_clip'`).

Run: `pnpm build`
Expected: build OK (compila la ruta del wizard sin errores).

- [ ] **Step 8: Correr la suite completa (regresión)**

Run: `pnpm exec vitest run`
Expected: PASS (incluye el test del helper; nada más cambió de lógica).

- [ ] **Step 9: Commit**

```bash
git add components/campaigns/CampaignStudioWizard.tsx
git commit -m "feat(campaigns): toggle de audio recomienda segun voz del personaje"
```

---

## QA manual (post-implementación, lo corre el usuario)

- Seleccionar un personaje CON voz: "Voz del clip anterior" muestra "Recomendado" y el copy explica que mantiene el timbre. El radio arranca en esa opción.
- Seleccionar un personaje SIN voz: "Pista musical" muestra "Recomendado"; copy de ritmo.
- No seleccionar personaje: copy "Sin personaje que hable…"; recomendación music.
- Tocar manualmente la otra opción y luego cambiar la selección de personajes: la elección manual se respeta (no se re-recomienda).

## Notas de cierre

- El spec vive en `docs/superpowers/specs/2026-07-08-wizard-audio-voz-inteligente-design.md` (aún sin commitear; se commitea junto con el código o al final, según pida el usuario).
- Sin migraciones ni cambios de backend: no aplica el orden migración→push.
