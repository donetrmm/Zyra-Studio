# Fixes de la auditoría de Campañas y Storyboard — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los 6 hallazgos confirmados de la auditoría 2026-07-01: promote de panel sin recuperación, doble generación de paneles, TOCTOU en actions de campaña, motivo de fallo de panel no persistente, update sin verificar en requestFinal, y lote cortado por créditos sin señal.

**Architecture:** Cambios quirúrgicos sobre el flujo existente: UPDATE/DELETE condicionados por status (anti-TOCTOU), promote idempotente con guard de frescura + 500 para que QStash reintente + auto-heal al cargar la página, guard de generación-en-vuelo en las actions de panel, y warnings persistentes en `campaign_items` (la UI ya los renderiza).

**Tech Stack:** Next.js 15 App Router, Supabase (RLS + admin client en worker), Upstash QStash (`retries: 3`), Vitest.

## Global Constraints

- **Un commit atómico por task** (autorizado por el usuario 2026-07-01). Formato `.cursor/rules/90-commits.mdc`: conventional commit en español, imperativo, ≤70 chars, **SIN trailer `Co-Authored-By`**. `git add` selectivo de los archivos de la task (nunca `git add -A`). El mensaje exacto viene en el dispatch de cada task.
- `server-actions/*.ts` son archivos `'use server'`: **NO exportar constantes ni objetos** desde ellos (rompe el build en prod, no lo detecta typecheck). Constantes nuevas van sin `export`.
- Errores de server actions: `return { ok: false, error: '<code>' }`, nunca throw hacia el cliente. Códigos bespoke ya establecidos en storyboard: `no_panel`, `compile_error` — los nuevos (`in_flight`, `max_turns`) siguen ese patrón.
- Créditos SIEMPRE vía `reserveCredits`/`failGeneration`/RPCs — nunca tocar `credit_balances` directo.
- `createAdminClient()` solo en worker/orquestador; en server actions usar `createClient()` (RLS) salvo delete de generations tras reserva fallida (patrón existente).
- Sin emojis en código ni UI. Mensajes user-facing en español. Comentarios de código en español (estilo del repo).
- Tests unitarios: Vitest, colocados junto al archivo (`foo.ts` + `foo.test.ts`). Solo funciones puras — NO mockear el cliente Supabase entero (anti-pattern del repo). Comandos: `pnpm typecheck`, `pnpm test` (= `vitest run`), `pnpm build` al final.
- No modificar migraciones aplicadas. Este plan NO requiere migraciones (la columna `campaign_items.warnings` ya existe).

**Contexto de los archivos grandes** (para no perderse):
- `server-actions/campaigns.ts` (~2400 líneas): `updateCampaignItemAction` ~892, `deleteCampaignItemAction` ~1098, `requestFinalAction` ~1521.
- `server-actions/storyboard.ts` (~610 líneas): `generatePanelAction` ~165, `refinePanelAction` ~398.
- `app/api/jobs/process/route.ts`: handler `promote_storyboard` ~103, camino `fail` ~201, encolado del promote ~250.
- `lib/campaigns/orchestrator.ts`: loop de `enqueueBatch` ~836-1074, rama `insufficient_credits` ~1034.
- `components/campaigns/StoryboardView.tsx` (~600 líneas): `ERROR_MESSAGES`/`friendlyError` ~15-25, card del beat ~434-560.

---

### Task 1: Anti-TOCTOU en updateCampaignItemAction y deleteCampaignItemAction

**Files:**
- Modify: `server-actions/campaigns.ts:966-975` (updateCampaignItemAction) y `server-actions/campaigns.ts:1114-1117` (deleteCampaignItemAction)

**Interfaces:**
- Consumes: nada de otras tasks.
- Produces: mismas firmas públicas; `updateCampaignItemAction` ahora puede devolver `{ ok: false, error: 'forbidden' }` también en la escritura; `deleteCampaignItemAction` ídem.

**Problema:** ambos actions validan el status con la fila leída (check-then-act). Si el item pasa a `queued`/`sample` entre la lectura y la escritura, el UPDATE lo devuelve a `planned` (re-habilita "Generar" → doble cobro) o el DELETE borra un item con generación en vuelo.

- [ ] **Step 1: Condicionar el UPDATE en updateCampaignItemAction**

Reemplazar el bloque de las líneas 966-972 (el `const { data: updated, error } = await supabase...`) por:

```typescript
  // Guard anti-TOCTOU: el check de status de arriba usa la fila leída; una
  // transición concurrente (approve/generate) pudo ganarle entre la lectura y
  // este UPDATE. Cuando el patch toca producción se condiciona por status: si
  // el item ya entró a producción el UPDATE afecta 0 filas (PGRST116) y se
  // devuelve forbidden en vez de re-habilitarlo (doble cobro).
  let updateQuery = supabase.from('campaign_items').update(patch).eq('id', parsed.data.itemId);
  if (touchesProduction) {
    updateQuery = updateQuery.in('status', ['planned', 'skipped', 'failed']);
  }
  const { data: updated, error } = await updateQuery.select('status').single();
  if (error || !updated) {
    if ((error as { code?: string } | null)?.code === 'PGRST116') {
      return { ok: false, error: 'forbidden', message: 'El item ya está en producción' };
    }
    return { ok: false, error: 'internal_error', message: error?.message };
  }
```

El comentario existente sobre "Devolver el status REAL post-update" (líneas 962-965) se conserva encima de este bloque.

- [ ] **Step 2: Condicionar el DELETE en deleteCampaignItemAction**

Reemplazar las líneas 1114-1115 (`const { error } = await supabase.from('campaign_items').delete()...`) por:

```typescript
  // Guard anti-TOCTOU: mismo patrón que updateCampaignItemAction — si el item
  // entró a producción entre la lectura y el DELETE, no borrarlo (dejaría una
  // generación en vuelo huérfana apuntando a un item inexistente).
  const { error, count } = await supabase
    .from('campaign_items')
    .delete({ count: 'exact' })
    .eq('id', itemId)
    .in('status', ['planned', 'skipped', 'failed']);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  if (count === 0) {
    return { ok: false, error: 'forbidden', message: 'El item ya está en producción' };
  }
```

- [ ] **Step 3: Verificar**

Run: `pnpm typecheck`
Expected: sin errores.

Nota: no hay test unitario para esto — requiere DB real (integration) y el repo prohíbe mockear el cliente Supabase entero. La verificación es typecheck + review.

---

### Task 2: Claim atómico en requestFinalAction (anti doble-submit + link verificado)

**Files:**
- Modify: `server-actions/campaigns.ts:1521-1617` (requestFinalAction)

**Interfaces:**
- Consumes: nada de otras tasks.
- Produces: misma firma pública; nuevo retorno posible `{ ok: false, error: 'forbidden', message: 'Ya hay un render final en curso para este item' }`.

**Problema:** (a) dos submits rápidos pasan el guard `status === 'draft_ready'` (línea 1535) con la misma lectura → dos renders finales cobrados; (b) el update del item a `approved` (líneas 1598-1601) no verifica error → si falla, el render corre y cobra pero el item nunca lo referencia.

**Solución:** reclamar el item con UPDATE condicionado ANTES de crear la generación; enlazar `generation_id` ANTES de encolar (verificado); revertir el claim en todos los caminos de fallo.

- [ ] **Step 1: Insertar el claim justo antes del insert de la generación**

Después del cálculo de `cost` (línea ~1559, `const cost = seedanceCostPerItem(...)`) y ANTES del `const { data: inserted, error: insertErr } = await supabase.from('generations').insert(...)`, insertar:

```typescript
  // Claim atómico anti doble-submit: draft_ready -> approved ANTES de crear la
  // generación. Dos requests concurrentes pasan el guard de arriba con la misma
  // lectura; solo el que gana este UPDATE condicionado sigue — el otro ve count
  // 0 y sale sin cobrar un segundo render final.
  const { count: claimed } = await supabase
    .from('campaign_items')
    .update({ status: 'approved' }, { count: 'exact' })
    .eq('id', item.id)
    .eq('status', 'draft_ready');
  if (claimed === 0) {
    return { ok: false, error: 'forbidden', message: 'Ya hay un render final en curso para este item' };
  }
  // Devuelve el item a draft_ready apuntando al draft, solo si nadie más lo
  // movió después de nosotros (condición por status='approved').
  const revertClaim = async () => {
    await supabase
      .from('campaign_items')
      .update({ status: 'draft_ready', generation_id: item.generation_id })
      .eq('id', item.id)
      .eq('status', 'approved');
  };
```

- [ ] **Step 2: Revertir el claim si el insert de la generación falla**

Reemplazar el bloque `if (insertErr || !inserted) { return ... }` (líneas ~1584-1586) por:

```typescript
  if (insertErr || !inserted) {
    await revertClaim();
    return { ok: false, error: 'internal_error', message: insertErr?.message ?? 'no row' };
  }
```

- [ ] **Step 3: Reestructurar reserva + link + enqueue**

Reemplazar el bloque completo desde `let reserved = false;` hasta el cierre del `catch` (líneas ~1589-1616) por:

```typescript
  let reserved = false;
  try {
    reserved = await reserveCredits(user.id, cost, generationId);
    if (!reserved) {
      // Reserva fallida: sin créditos cargados. Borrar la fila y liberar el claim.
      const admin = createAdminClient();
      await admin.from('generations').delete().eq('id', generationId);
      await revertClaim();
      return { ok: false, error: 'insufficient_credits' };
    }
    // Enlazar el item al render final ANTES de encolar: si este UPDATE falla se
    // aborta sin encolar (antes era post-enqueue y sin verificar: el render
    // corría y cobraba pero el item nunca lo referenciaba).
    const { error: linkErr } = await supabase
      .from('campaign_items')
      .update({ generation_id: generationId })
      .eq('id', item.id);
    if (linkErr) {
      throw new Error(`no se pudo enlazar el item al render final: ${linkErr.message}`);
    }
    await enqueueJob({ generationId, action: 'submit' });
    revalidatePath(`/app/campaigns/${item.campaign_id}`);
    return { ok: true, data: { generationId } };
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown';
    try {
      await failGeneration(user.id, generationId, reserved ? cost : 0, `final_enqueue: ${message}`);
    } catch (failErr) {
      console.error('[request_final:fail_generation]', {
        generationId,
        error: message,
        failError: (failErr as Error)?.message,
      });
    }
    try {
      await revertClaim();
    } catch (revertErr) {
      console.error('[request_final:revert_claim]', {
        generationId,
        error: (revertErr as Error)?.message,
      });
    }
    return { ok: false, error: 'internal_error', message };
  }
```

Nota: `revertClaim` restaura `generation_id` al draft (`item.generation_id`), así el item vuelve a apuntar a su draft aunque el link ya se hubiera escrito.

- [ ] **Step 4: Verificar**

Run: `pnpm typecheck`
Expected: sin errores.

---

### Task 3: Motivo de fallo de panel persistente (worker → item → UI)

**Files:**
- Modify: `app/api/jobs/process/route.ts:218-230` (camino fail)
- Modify: `app/app/campaigns/[id]/storyboard/page.tsx:31-35` (select) y `:80-88` (mapeo de beats)
- Modify: `lib/campaigns/storyboard-types.ts` (StoryboardBeat)
- Modify: `components/campaigns/StoryboardView.tsx` (render del warning + tipo local si existe)
- Modify: `server-actions/storyboard.ts` (limpiar warnings al reintentar, en generatePanelAction y refinePanelAction)

**Interfaces:**
- Consumes: `storyboardCampaignItemId(generation)` ya importado en route.ts (se usa en la línea ~250).
- Produces: `StoryboardBeat` gana el campo `warnings: string[]`. La página lo puebla desde `campaign_items.warnings`.

**Problema:** el worker anota el motivo del fallo con `.eq('generation_id', generation.id)`, columna que los paneles NO usan (se linkean por `storyboard_generation_id` y solo al promover) → para paneles ese UPDATE afecta 0 filas. El motivo (moderación/timeout/rate limit) solo se ve en vivo por Realtime; tras un reload el beat queda mudo.

- [ ] **Step 1: Rutear el warning al item correcto en el worker**

En `app/api/jobs/process/route.ts`, dentro del `try` del camino fail (tras construir `reason`, línea ~219-226), reemplazar la línea:

```typescript
      await admin.from('campaign_items').update({ warnings: [reason] }).eq('generation_id', generation.id);
```

por:

```typescript
      // Paneles de storyboard: el item se linkea por params.storyboard (no por
      // generation_id, que solo usan los items de video) — sin este branch el
      // UPDATE afecta 0 filas y el motivo del fallo se pierde tras un reload.
      const sbItemId = storyboardCampaignItemId(generation);
      if (sbItemId) {
        await admin.from('campaign_items').update({ warnings: [reason] }).eq('id', sbItemId);
      } else {
        await admin.from('campaign_items').update({ warnings: [reason] }).eq('generation_id', generation.id);
      }
```

- [ ] **Step 2: Agregar `warnings` a StoryboardBeat**

En `lib/campaigns/storyboard-types.ts`, agregar al type `StoryboardBeat`:

```typescript
  // Motivo persistido del último fallo de generación del panel (worker lo anota,
  // la action de regenerar lo limpia). Vacío = sin aviso.
  warnings: string[];
```

- [ ] **Step 3: Poblar warnings en la página**

En `app/app/campaigns/[id]/storyboard/page.tsx`:

1. Agregar `warnings` al select de `campaign_items` (línea 33):

```typescript
    .select('id, scene_index, scene_prompt, storyboard_image_id, location_id, duration_s, sequence_id, sequence_label, format_id, created_at, warnings')
```

2. En el mapeo de `beats` (líneas 80-88), agregar:

```typescript
    warnings: (r.warnings as string[] | null) ?? [],
```

- [ ] **Step 4: Renderizar el warning en StoryboardView**

En `components/campaigns/StoryboardView.tsx`, en la card del beat, justo debajo del párrafo del prompt preview (`<p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground/70">{beat.scenePrompt}</p>`, líneas ~475-478), agregar:

```tsx
                {/* Motivo persistido del último fallo (el worker lo anota; regenerar lo limpia). */}
                {beat.warnings.length > 0 && !isGenerating && !isRefining && (
                  <p className="text-[11px] leading-snug text-amber-400/80">{beat.warnings[0]}</p>
                )}
```

Las variables `isGenerating`/`isRefining` ya existen en el scope de la card (se usan en la línea ~438). Si el componente define su propio type local para beats, agregarle `warnings: string[]` también.

- [ ] **Step 5: Limpiar el warning al reintentar**

En `server-actions/storyboard.ts`, en `generatePanelAction` Y en `refinePanelAction`, justo después del `try { await enqueueJob({ generationId, action: 'submit' }); } catch { ... }` exitoso y antes del `return { ok: true, ... }`, agregar:

```typescript
  // Limpia el aviso del intento fallido anterior: ya hay una generación nueva en
  // vuelo. Best-effort (el cliente supabase no lanza; un error aquí no bloquea).
  await supabase.from('campaign_items').update({ warnings: [] }).eq('id', itemId);
```

(En `generatePanelAction` la variable `supabase` se declara en la línea ~292; en `refinePanelAction` en la ~484 — ambas disponibles en ese punto.)

- [ ] **Step 6: Verificar**

Run: `pnpm typecheck && pnpm test`
Expected: sin errores; tests existentes (incluido `use-storyboard-panel-realtime.test.ts`) siguen en verde.

---

### Task 4: Promote confiable (500→retry QStash, idempotencia, frescura, auto-heal)

**Files:**
- Modify: `lib/jobs/storyboard-finalize.ts` (idempotencia + guard de frescura)
- Test: `lib/jobs/storyboard-finalize.test.ts` (extender con `isStalePromote`)
- Modify: `app/api/jobs/process/route.ts:103-120` (handler promote → 500 en fallo)
- Create: `lib/campaigns/storyboard-promote-heal.ts` (helper puro)
- Create: `lib/campaigns/storyboard-promote-heal.test.ts`
- Modify: `app/app/campaigns/[id]/storyboard/page.tsx` (auto-heal al cargar)

**Interfaces:**
- Consumes: `enqueueJob` de `lib/jobs/queue.ts` (publica con `retries: 3` — por eso el 500 produce reintentos acotados). El select de la página ya incluye `warnings` (Task 3); esta task agrega `storyboard_generation_id`.
- Produces: `isStalePromote(genCreatedAt: string | null, linkedCreatedAt: string | null | undefined): boolean` exportada de `lib/jobs/storyboard-finalize.ts`. `findUnpromotedPanels(gens: HealGenRow[], items: HealItemRow[]): string[]` exportada de `lib/campaigns/storyboard-promote-heal.ts` con `HealGenRow = { id: string; created_at: string; params: Record<string, unknown> }` y `HealItemRow = { id: string; storyboard_generation_id: string | null }`.

**Problema:** el promote es best-effort en sus dos eslabones (encolado y ejecución): si falla, la generación queda `done` (créditos confirmados) pero el beat sin `storyboard_image_id` — panel cobrado e invisible, sin ruta de recuperación salvo regenerar pagando otra vez. Además un promote tardío/reintentado de una gen vieja puede pisar el link de un panel más nuevo.

- [ ] **Step 1: Test de `isStalePromote` (falla: la función no existe)**

Agregar a `lib/jobs/storyboard-finalize.test.ts`:

```typescript
import { isStalePromote } from './storyboard-finalize';

describe('isStalePromote', () => {
  it('promueve cuando no hay panel enlazado previo', () => {
    expect(isStalePromote('2026-07-01T10:00:00Z', null)).toBe(false);
    expect(isStalePromote('2026-07-01T10:00:00Z', undefined)).toBe(false);
  });
  it('promueve cuando esta gen es más nueva que la enlazada', () => {
    expect(isStalePromote('2026-07-01T10:05:00Z', '2026-07-01T10:00:00Z')).toBe(false);
  });
  it('NO promueve cuando la enlazada es más nueva (retry tardío de una gen vieja)', () => {
    expect(isStalePromote('2026-07-01T10:00:00Z', '2026-07-01T10:05:00Z')).toBe(true);
  });
  it('promueve si falta el created_at propio (mejor enlazar que dejar huérfano)', () => {
    expect(isStalePromote(null, '2026-07-01T10:05:00Z')).toBe(false);
  });
});
```

(Ajustar el estilo de import al del archivo de test existente; usa `describe`/`it`/`expect` de vitest.)

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm test lib/jobs/storyboard-finalize.test.ts`
Expected: FAIL — `isStalePromote` no está exportada.

- [ ] **Step 3: Implementar idempotencia + frescura en promoteStoryboardPanel**

Reemplazar el cuerpo de `lib/jobs/storyboard-finalize.ts` (conservando `storyboardCampaignItemId` tal cual) para que `promoteStoryboardPanel` quede así, y agregar `isStalePromote`:

```typescript
// Un promote reintentado (QStash) o tardío no debe pisar un panel más nuevo ya
// enlazado. Devuelve true si la gen enlazada es más reciente que esta. Puro.
export function isStalePromote(
  genCreatedAt: string | null,
  linkedCreatedAt: string | null | undefined,
): boolean {
  if (!genCreatedAt || !linkedCreatedAt) return false;
  return new Date(linkedCreatedAt).getTime() > new Date(genCreatedAt).getTime();
}

// Post-step del storyboard tras finalize (mueve lo que hacia el server action inline):
// promueve el output ya subido a media_reference y lo linkea al campaign_item.
// Idempotente (guard por storyboard_generation_id) y con guard de frescura: seguro
// de reintentar — el worker devuelve 500 si falla y QStash lo reintenta.
export async function promoteStoryboardPanel(gen: GenerationRow): Promise<void> {
  const itemId = storyboardCampaignItemId(gen);
  if (!itemId) return;
  const admin = createAdminClient();

  const { data: itemRow } = await admin
    .from('campaign_items')
    .select('storyboard_generation_id')
    .eq('id', itemId)
    .single();
  const linkedId =
    (itemRow as { storyboard_generation_id?: string | null } | null)?.storyboard_generation_id ?? null;
  // Idempotencia: este promote ya corrió (retry de QStash) — nada que hacer.
  if (linkedId === gen.id) return;

  const { data } = await admin
    .from('generations')
    .select('output_url, created_at')
    .eq('id', gen.id)
    .single();
  const row = data as { output_url?: string | null; created_at?: string | null } | null;
  const outputUrl = row?.output_url ?? null;
  if (!outputUrl) return;

  if (linkedId) {
    const { data: linked } = await admin
      .from('generations')
      .select('created_at')
      .eq('id', linkedId)
      .single();
    const linkedCreatedAt = (linked as { created_at?: string } | null)?.created_at;
    if (isStalePromote(row?.created_at ?? null, linkedCreatedAt)) return;
  }

  const imageId = await promoteOutputToReference(gen.workspace_id, gen.user_id, outputUrl, gen.id);
  await admin
    .from('campaign_items')
    .update({ storyboard_image_id: imageId, storyboard_generation_id: gen.id })
    .eq('id', itemId);
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `pnpm test lib/jobs/storyboard-finalize.test.ts`
Expected: PASS.

- [ ] **Step 5: 500 en el handler promote para que QStash reintente**

En `app/api/jobs/process/route.ts`, reemplazar el bloque `if (action === 'promote_storyboard') { ... }` (líneas ~103-120) por:

```typescript
  if (action === 'promote_storyboard') {
    try {
      await promoteStoryboardPanel(generation);
      // El evento 'done' de Realtime lo disparó el finalize ANTES de que existiera
      // el enlace, así que el cliente ya refrescó con el panel viejo. Este UPDATE
      // idempotente re-emite el evento para que refresque de nuevo, ahora con el
      // beat enlazado. provider_payload no viaja en el broadcast (migración 050),
      // así que el record queda chico.
      await admin
        .from('generations')
        .update({ status: 'done' })
        .eq('id', generation.id)
        .eq('status', 'done');
    } catch (err) {
      console.error('[worker] promote storyboard panel fallo', { generationId, err });
      // 500 -> QStash reintenta la entrega (retries: 3 en enqueueJob). El promote
      // es idempotente y con guard de frescura, así que reintentar es seguro.
      // Antes se hacía ack aquí: el panel quedaba cobrado pero sin enlazar, y la
      // única salida era regenerarlo pagando de nuevo.
      return NextResponse.json({ ok: false, error: 'promote_failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, ack: 'promoted' });
  }
```

- [ ] **Step 6: Test del helper puro de auto-heal (falla: el archivo no existe)**

Create `lib/campaigns/storyboard-promote-heal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { findUnpromotedPanels, type HealGenRow, type HealItemRow } from './storyboard-promote-heal';

const gen = (id: string, beatId: string | null, createdAt: string): HealGenRow => ({
  id,
  created_at: createdAt,
  params: beatId ? { storyboard: { campaignItemId: beatId } } : {},
});

describe('findUnpromotedPanels', () => {
  const items: HealItemRow[] = [
    { id: 'beat-1', storyboard_generation_id: 'gen-a' },
    { id: 'beat-2', storyboard_generation_id: null },
  ];

  it('vacío cuando la gen más nueva de cada beat ya está enlazada', () => {
    expect(findUnpromotedPanels([gen('gen-a', 'beat-1', '2026-07-01T10:00:00Z')], items)).toEqual([]);
  });

  it('detecta el beat sin enlace (promote perdido)', () => {
    expect(findUnpromotedPanels([gen('gen-b', 'beat-2', '2026-07-01T10:00:00Z')], items)).toEqual(['gen-b']);
  });

  it('detecta cuando hay una gen más nueva que la enlazada (refine sin promote)', () => {
    const gens = [
      gen('gen-a', 'beat-1', '2026-07-01T10:00:00Z'),
      gen('gen-c', 'beat-1', '2026-07-01T10:05:00Z'),
    ];
    expect(findUnpromotedPanels(gens, items)).toEqual(['gen-c']);
  });

  it('elige la más nueva aunque lleguen desordenadas', () => {
    const gens = [
      gen('gen-c', 'beat-1', '2026-07-01T10:05:00Z'),
      gen('gen-d', 'beat-1', '2026-07-01T10:10:00Z'),
      gen('gen-a', 'beat-1', '2026-07-01T10:00:00Z'),
    ];
    expect(findUnpromotedPanels(gens, items)).toEqual(['gen-d']);
  });

  it('ignora gens sin payload de storyboard o de beats desconocidos', () => {
    const gens = [gen('gen-x', null, '2026-07-01T10:00:00Z'), gen('gen-y', 'beat-999', '2026-07-01T10:00:00Z')];
    expect(findUnpromotedPanels(gens, items)).toEqual([]);
  });
});
```

- [ ] **Step 7: Correr el test para verlo fallar**

Run: `pnpm test lib/campaigns/storyboard-promote-heal.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 8: Implementar el helper puro**

Create `lib/campaigns/storyboard-promote-heal.ts`:

```typescript
// Detecta paneles de storyboard cuyo promote se perdió: la generación 'done' más
// reciente de cada beat debería ser la enlazada (storyboard_generation_id). Si no
// lo es, ese promote murió (encolado fallido o job agotó reintentos) y hay que
// re-encolarlo. Puro: la página hace las queries y este helper decide.

export type HealGenRow = { id: string; created_at: string; params: Record<string, unknown> };
export type HealItemRow = { id: string; storyboard_generation_id: string | null };

export function findUnpromotedPanels(gens: HealGenRow[], items: HealItemRow[]): string[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const newestByBeat = new Map<string, HealGenRow>();
  for (const g of gens) {
    const sb = (g.params ?? {}) as { storyboard?: { campaignItemId?: unknown } };
    const beatId = sb.storyboard?.campaignItemId;
    if (typeof beatId !== 'string' || !itemById.has(beatId)) continue;
    const cur = newestByBeat.get(beatId);
    if (!cur || new Date(g.created_at).getTime() > new Date(cur.created_at).getTime()) {
      newestByBeat.set(beatId, g);
    }
  }
  const out: string[] = [];
  for (const [beatId, g] of newestByBeat) {
    if (itemById.get(beatId)!.storyboard_generation_id !== g.id) out.push(g.id);
  }
  return out;
}
```

- [ ] **Step 9: Correr el test para verlo pasar**

Run: `pnpm test lib/campaigns/storyboard-promote-heal.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 10: Auto-heal al cargar la página de storyboard**

En `app/app/campaigns/[id]/storyboard/page.tsx`:

1. Agregar `storyboard_generation_id` al select de `campaign_items` (que tras Task 3 ya incluye `warnings`):

```typescript
    .select('id, scene_index, scene_prompt, storyboard_image_id, storyboard_generation_id, location_id, duration_s, sequence_id, sequence_label, format_id, created_at, warnings')
```

2. Agregar imports:

```typescript
import { enqueueJob } from '@/lib/jobs/queue';
import { findUnpromotedPanels, type HealGenRow, type HealItemRow } from '@/lib/campaigns/storyboard-promote-heal';
```

3. Después de construir `rows` (línea ~37) y antes del mapeo de beats, agregar:

```typescript
  // Auto-heal de promotes perdidos: si el job promote murió tras agotar los
  // reintentos de QStash, la gen quedó 'done' (cobrada) sin enlazar al beat.
  // Al cargar la página se detecta y se re-encola (el promote es idempotente y
  // con guard de frescura). Solo gens con >2 min de antigüedad: las recientes
  // suelen tener su promote todavía en vuelo. Best-effort: el render no depende.
  const { data: doneGens } = await supabase
    .from('generations')
    .select('id, created_at, params')
    .eq('campaign_id', id)
    .eq('status', 'done')
    .eq('type', 'image')
    .not('params->storyboard', 'is', null)
    .lt('created_at', new Date(Date.now() - 2 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(100);
  const healItems: HealItemRow[] = rows.map((r) => ({
    id: r.id as string,
    storyboard_generation_id: (r.storyboard_generation_id as string | null) ?? null,
  }));
  const pendingPromotes = findUnpromotedPanels((doneGens ?? []) as HealGenRow[], healItems).slice(0, 12);
  for (const genId of pendingPromotes) {
    try {
      await enqueueJob({ generationId: genId, action: 'promote_storyboard' });
    } catch (err) {
      console.error('[storyboard:page] re-promote enqueue fallo', { genId, err });
    }
  }
```

- [ ] **Step 11: Verificar**

Run: `pnpm typecheck && pnpm test`
Expected: sin errores, todos los tests en verde.

---

### Task 5: Guard de concurrencia y límite de turnos en las actions de panel

**Files:**
- Modify: `server-actions/storyboard.ts` (generatePanelAction ~línea 173, refinePanelAction ~línea 411)
- Modify: `components/campaigns/StoryboardView.tsx` (ERROR_MESSAGES, ~línea 15-22)

**Interfaces:**
- Consumes: nada de otras tasks (coexiste con los cambios de Task 3 en los mismos archivos).
- Produces: nuevos códigos de error `in_flight` y `max_turns` en ambas actions; mensajes en `ERROR_MESSAGES` del view.

**Problema:** ninguna de las dos actions comprueba si ya hay una generación en vuelo para el beat — el único candado es estado local del cliente (doble click, dos pestañas o un reload a media generación → dos cobros). Y el refinado no tiene límite de turnos (el refinado de items de campaña usa 10).

- [ ] **Step 1: Guard de en-vuelo en generatePanelAction**

En `server-actions/storyboard.ts`, dentro de `generatePanelAction`, justo después de `const { item, campaign } = loaded;` (línea ~175), agregar:

```typescript
  // Guard de concurrencia: si ya hay una generación de este panel en vuelo, no
  // crear otra (doble click, segunda pestaña o reload a media generación =
  // doble cobro). El candado del cliente (botones disabled) no cubre esos casos.
  // Queda una ventana check→insert entre requests simultáneos; aceptable a esta
  // escala (cerrarla del todo pediría un unique index parcial sobre JSONB).
  const guardClient = await createClient();
  const { count: inFlight } = await guardClient
    .from('generations')
    .select('id', { count: 'exact', head: true })
    .contains('params', { storyboard: { campaignItemId: itemId } })
    .in('status', ['queued', 'processing']);
  if ((inFlight ?? 0) > 0) {
    return { ok: false, error: 'in_flight' };
  }
```

Nota: `generatePanelAction` ya crea más abajo `locClient` (línea ~188) y `supabase` (línea ~292); si resulta más limpio, mover la declaración de un único cliente arriba y reutilizarlo — sin cambiar el comportamiento.

- [ ] **Step 2: Guard de en-vuelo + límite de turnos en refinePanelAction**

Dentro de `refinePanelAction`, justo después del check `if (!item.storyboard_image_id) { return { ok: false, error: 'no_panel' }; }` (línea ~414-416), agregar:

```typescript
  // Mismo guard de concurrencia que generatePanelAction: no refinar mientras
  // otra generación del beat está en vuelo (incluye una regeneración en curso:
  // el refinado encadenaría sobre un panel que está a punto de ser reemplazado).
  const guardClient = await createClient();
  const { count: inFlight } = await guardClient
    .from('generations')
    .select('id', { count: 'exact', head: true })
    .contains('params', { storyboard: { campaignItemId: itemId } })
    .in('status', ['queued', 'processing']);
  if ((inFlight ?? 0) > 0) {
    return { ok: false, error: 'in_flight' };
  }

  // Límite de turnos de refinado por sesión de panel (paridad con el refinado
  // de items de campaña). Un refinado se distingue por parent_generation_id
  // (solo el refine lo setea). La sesión arranca en la última generación FRESCA
  // del beat (sin parent): regenerar el panel empieza una sesión nueva y
  // resetea la cuenta — coherente con el mensaje que ve el usuario.
  const { data: lastFresh } = await guardClient
    .from('generations')
    .select('created_at')
    .contains('params', { storyboard: { campaignItemId: itemId } })
    .is('parent_generation_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  let turnsQuery = guardClient
    .from('generations')
    .select('id', { count: 'exact', head: true })
    .contains('params', { storyboard: { campaignItemId: itemId } })
    .not('parent_generation_id', 'is', null)
    .in('status', ['queued', 'processing', 'done']);
  const lastFreshAt = (lastFresh as { created_at?: string } | null)?.created_at;
  if (lastFreshAt) {
    turnsQuery = turnsQuery.gt('created_at', lastFreshAt);
  }
  const { count: turns } = await turnsQuery;
  if ((turns ?? 0) >= MAX_REFINE_TURNS) {
    return { ok: false, error: 'max_turns' };
  }
```

Y arriba del archivo, junto a las otras constantes (`FLUX_MODEL_SLUG`, etc.), agregar SIN export (archivo `'use server'` — exportar constantes rompe el build):

```typescript
// Tope de refinados por panel (paridad con el refinado conversacional de items).
// NO exportar: este archivo es 'use server' y exportar no-funciones rompe en prod.
const MAX_REFINE_TURNS = 10;
```

Nota: `refinePanelAction` declara `const supabase = await createClient();` en la línea ~484 — con el guard arriba, reutilizar `guardClient` y eliminar la declaración duplicada, o dejar ambas; a criterio del implementador manteniendo typecheck limpio.

- [ ] **Step 3: Mensajes en el cliente**

En `components/campaigns/StoryboardView.tsx`, agregar a `ERROR_MESSAGES` (objeto justo antes de `friendlyError`, línea ~15-22):

```typescript
  in_flight: 'Este panel ya se está generando. Espera a que termine.',
  max_turns: 'Límite de refinados alcanzado para este panel (10). Regenera el panel para empezar una sesión nueva.',
```

(Respetar el formato/keys existentes del objeto.)

- [ ] **Step 4: Verificar**

Run: `pnpm typecheck && pnpm test`
Expected: sin errores.

Nota: los guards son queries — no hay lógica pura nueva que testear sin mockear Supabase (anti-pattern del repo). Verificación: typecheck + review.

---

### Task 6: Señal persistente al cortar el lote por créditos insuficientes

**Files:**
- Modify: `lib/campaigns/orchestrator.ts:1034-1039` (rama `!reserved` de enqueueBatch)

**Interfaces:**
- Consumes: `selected` (array de items del lote, definido arriba del loop, línea ~836) e `idx` (índice del loop). `createAdminClient` ya importado.
- Produces: nada nuevo; los items no encolados quedan con `warnings` poblado (la UI ya renderiza `item.warnings[0]` y el canal Realtime de `CampaignStudioView` ya propaga updates de `warnings`).

**Problema:** al agotarse el saldo, el lote se corta (`break`) y los items restantes quedan en `planned` sin ninguna señal persistente — el toast muere y tras un reload el usuario no sabe por qué la mitad del plan no se generó.

- [ ] **Step 1: Persistir el warning en los items no encolados**

En la rama `if (!reserved) { ... }` (líneas ~1034-1039), reemplazar por:

```typescript
      if (!reserved) {
        const admin = createAdminClient();
        await admin.from('generations').delete().eq('id', generationId);
        result.skipped.push({ itemId: item.id, reason: 'insufficient_credits' });
        // Señal persistente: sin esto los items restantes del lote quedan mudos
        // (el toast muere y tras un reload nadie sabe por qué no se generaron).
        // El warning se limpia solo al re-encolar (el update post-enqueue del
        // lote escribe warnings de compilación encima).
        const remainingIds = selected.slice(idx).map((it) => it.id);
        await admin
          .from('campaign_items')
          .update({ warnings: ['Sin créditos: este item no entró al lote. Regenéralo cuando tengas saldo.'] })
          .in('id', remainingIds);
        // Sin créditos no tiene caso seguir con el resto del lote.
        break;
      }
```

- [ ] **Step 2: Verificar**

Run: `pnpm typecheck && pnpm test`
Expected: sin errores; `lib/campaigns/campaigns.test.ts` y demás siguen en verde.

---

### Task 7: Verificación integral

**Files:** ninguno nuevo.

- [ ] **Step 1: Suite completa**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: todo en verde.

- [ ] **Step 2: Build de producción**

Run: `pnpm build`
Expected: build exitoso. Crítico por la regla de `'use server'`: exportar una constante desde `server-actions/storyboard.ts` NO lo detecta typecheck, solo el build (gotcha documentado del repo).

- [ ] **Step 3: Revisión del diff completo**

Run: `git diff --stat` y `git diff`
Expected: solo los archivos listados en las tasks 1-6. Reportar el resumen al usuario. NO commitear (el usuario decide los commits al final).

---

## Fuera de alcance (decidido en la auditoría)

- Paginación de `campaign_items` (escala demo, no aplica).
- `generateSeriesAction` + Realtime INSERT: **ya estaba arreglado** — el cliente agrega los items devueltos vía `onSeriesCreated` (CampaignStudioView.tsx:1659-1661).
- Unique index parcial sobre `params.storyboard.campaignItemId` para cerrar al 100% la ventana check→insert del guard de concurrencia: requiere migración; la ventana residual es de milisegundos entre requests simultáneos. Documentado en el comentario del guard.
- Botón "reintentar los saltados" del lote: el warning persistente + regenerar por item cubre el caso; un bulk-retry es feature nueva, no fix.
