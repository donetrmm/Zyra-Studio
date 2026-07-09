# V3 Fase 4 — Prioridad de referencias por clip · Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Pasos con checkbox (`- [ ]`).

**Goal:** La prioridad de referencias pasa de **por campaña** a **por clip**: la generación lee `campaign_items.reference_selection` del ítem (con fallback a la de campaña), y un diálogo de referencias por clip muestra el pool del **producto/activos de ESE clip** (reflejando el producto asignado en Fase 3).

**Architecture:** La lógica pura (`applyReferenceSelection`, `buildReferencePool`) ya es agnóstica de campaña vs. ítem — no se toca. Fase 4 cambia: (1) qué `reference_selection` lee la generación (por-ítem); (2) un `loadReferencePool` scopeado al ítem (producto del clip vía `resolveItemProduct`, su locación, su cast); (3) server actions por-ítem; (4) un diálogo por clip en el tablero, junto al selector de producto de Fase 3. `campaign_items.reference_selection` ya existe (migración 060, con backfill). **Sin migración nueva.**

**Tech Stack:** Next.js 15 App Router, Supabase, zod, RSC + `'use client'`, pnpm, vitest.

## Global Constraints

- pnpm; sin `any`; server actions `'use server'`+`server-only`+`Result<T>`+zod (`lib/schemas/`)+`requireWorkspace`+ownership por `workspace_id`+`revalidatePath`.
- Lógica pura en `lib/campaigns/*.ts` con test; server actions y UI: sin test unitario (typecheck+build+review).
- **No regresión**: la generación debe seguir aplicando la selección correcta. El backfill de 060 ya copió `campaigns.reference_selection` → `campaign_items.reference_selection`; leer `item.reference_selection ?? campaign.reference_selection` preserva el comportamiento (item gana; campaña = fallback/compat). `null` en ambos = automático (comportamiento actual).
- `applyReferenceSelection` filtra el `DirectorContext` **upstream** (antes de compilar), nunca post-filtro — mantenerlo así.
- El pool por-clip debe reflejar el producto del ítem (`item.product_id` → `resolveItemProduct`), NO el producto de campaña.
- No emojis; dark mode; shadcn primero.

## File Structure

- `lib/campaigns/orchestrator.ts` (modificar) — `ItemRow += reference_selection`; leer la selección del ítem en el loop de `enqueueBatch`.
- `server-actions/storyboard.ts` (modificar) — `CampaignItemRow += reference_selection`; leer la del ítem en `generatePanelAction`/`refinePanelAction`.
- `lib/campaigns/reference-pool.ts` (modificar) — `loadItemReferencePool(workspaceId, campaign, item)` que construye el pool desde el producto/activos del ítem.
- `lib/schemas/campaigns.ts` (modificar) — `SetItemReferenceSelectionSchema`.
- `server-actions/campaigns.ts` (modificar) — `getItemReferencePoolAction(itemId)`, `setItemReferenceSelectionAction(input)`.
- `components/campaigns/ReferencePoolDialog.tsx` (modificar) — modo por-ítem (`itemId`).
- `components/campaigns/CampaignStudioView.tsx` (modificar) — botón "Referencias" por clip en `PlanTable`, junto al selector de producto.

---

### Task 1: La generación lee `reference_selection` del ítem

**Files:**
- Modify: `lib/campaigns/orchestrator.ts`
- Modify: `server-actions/storyboard.ts`

**Interfaces:**
- `ItemRow` (orchestrator.ts ~38-69) `+= reference_selection: unknown | null`.
- `CampaignItemRow` (storyboard.ts ~62-86) `+= reference_selection: unknown | null`.

- [ ] **Step 1: `orchestrator.ts` — `ItemRow`**: añade `reference_selection: unknown` (jsonb crudo). Confirma que el `.select(...)` de `campaign_items` que alimenta `enqueueBatch` traiga `reference_selection` (búscalo — puede estar en `server-actions/campaigns.ts` en `generateItemAction`/`approveBatchAction`; añade la columna a esos selects).
- [ ] **Step 2: `orchestrator.ts` — leer por ítem**: en `enqueueBatch`, hoy `refSelection = normalizeReferenceSelection(campaign.reference_selection)` (~1055) es único para el lote. Muévelo/duplícalo DENTRO del loop de ítems (~1182): `const itemRefSelection = normalizeReferenceSelection(item.reference_selection ?? campaign.reference_selection ?? null);` y pásalo a `applyReferenceSelection(directorContextFor(...), itemRefSelection)`. (Mantén `campaign.reference_selection` como fallback.)
- [ ] **Step 3: `storyboard.ts` — `CampaignItemRow` + selects**: añade `reference_selection` al tipo y a los `.select` de `campaign_items` de `generatePanelAction`/`refinePanelAction` (los que arman `itemRow`).
- [ ] **Step 4: `storyboard.ts` — leer por ítem**: en `generatePanelAction` (~293) y `refinePanelAction` (~626), cambia `normalizeReferenceSelection(campaign.reference_selection)` por `normalizeReferenceSelection(itemRow.reference_selection ?? campaign.reference_selection ?? null)`.
- [ ] **Step 5: Verificar** — `pnpm typecheck` limpio, `pnpm build` compila, `pnpm test` verde. Como no hay test unitario del orchestrator para esto, relee: la selección por-ítem se aplica al `DirectorContext` de cada ítem antes de `compile`; el fallback a campaña preserva el comportamiento de campañas existentes (cuya item.reference_selection ya fue backfilleada).
- [ ] **Step 6: Commit** — `feat(v3): la generación aplica la selección de referencias del clip (fallback a la de campaña)`.

---

### Task 2: Pool de referencias scopeado al ítem (IO)

**Files:**
- Modify: `lib/campaigns/reference-pool.ts`

**Interfaces:**
- Consumes: `resolveItemProduct` (orchestrator.ts), `loadCampaignContext`, `buildReferencePool`/`buildReferencePoolTexts` (reference-selection.ts).
- Produces: `export async function loadItemReferencePool(workspaceId: string, campaign: ReferencePoolCampaignRow, item: { product_id: string | null; location_id: string | null; character_ids: string[] | null; reference_ids: string[] | null }): Promise<{ entries: ReferencePoolEntry[]; texts: ReferencePoolTexts }>`.

Lógica (espeja `loadReferencePool` ~36-114 pero por-ítem):
- **Producto**: si `item.product_id`, `resolveItemProduct(supabase, workspaceId, item.product_id, campaign.include_packaging !== false)` → usa sus `imagePaths`/`packagingImagePaths`/`imageUsages`/`name`. Si es null, cae al producto de campaña (`loadCampaignContext`) como hoy.
- **Cast**: solo los `item.character_ids` (no todos los de la campaña).
- **Locación**: solo `item.location_id` (no todas).
- **Extras**: solo `item.reference_ids`.
- Arma el `ReferencePoolInput` con esos activos y llama `buildReferencePool` + `buildReferencePoolTexts` igual que `loadReferencePool`.

- [ ] **Step 1: Escribir `loadItemReferencePool`** reusando los helpers de resolución de paths que ya usa `loadReferencePool` (`resolvePaths`, `resolveLocations`, etc.).
- [ ] **Step 2: Verificar** — `pnpm typecheck` + `pnpm build`. (Sin test unitario: es IO. La lógica pura que consume ya está testeada.)
- [ ] **Step 3: Commit** — `feat(v3): loadItemReferencePool (pool scopeado al producto/activos del clip)`.

---

### Task 3: Server actions de referencias por ítem

**Files:**
- Modify: `lib/schemas/campaigns.ts`, `server-actions/campaigns.ts`

**Interfaces:**
- Consumes: `loadItemReferencePool` (Task 2), `normalizeReferenceSelection`.
- Produces:
  - `SetItemReferenceSelectionSchema = z.object({ itemId: z.string().uuid(), include: z.array(z.string()).nullable() })`.
  - `getItemReferencePoolAction(itemId: string): Promise<Result<{ entries: (ReferencePoolEntry & { thumbUrl: string|null })[]; texts: ReferencePoolTexts; include: string[]|null }>>`.
  - `setItemReferenceSelectionAction(input: unknown): Promise<Result<{ savedCount: number|null }>>`.

Espeja `getReferencePoolAction`/`setReferenceSelectionAction` (~3163-3254) pero:
- Cargan el ítem + su campaña (ownership por `workspace_id` vía join, como `setItemProductAction`).
- Usan `loadItemReferencePool(workspace.id, campaign, item)` en vez de `loadReferencePool`.
- `getItemReferencePoolAction` devuelve `include` desde `normalizeReferenceSelection(item.reference_selection)`.
- `setItemReferenceSelectionAction`: intersecta el `include` contra `pool.entries` reales (descarta paths forjados/stale) igual que la de campaña; persiste con `.from('campaign_items').update({ reference_selection: value }).eq('id', itemId)`; gate de status editable (`planned/skipped/failed`) como `setItemProductAction`, con guard anti-TOCTOU (`.in('status', ...)` en el update).

- [ ] **Step 1: Schema** `SetItemReferenceSelectionSchema` en `lib/schemas/campaigns.ts`.
- [ ] **Step 2: `getItemReferencePoolAction`** en `server-actions/campaigns.ts` (ownership + `loadItemReferencePool` + firmar thumbnails + `include` del ítem).
- [ ] **Step 3: `setItemReferenceSelectionAction`** (ownership + intersección contra el pool del ítem + update de `campaign_items.reference_selection` con gate de status + anti-TOCTOU).
- [ ] **Step 4: Verificar** — `pnpm typecheck` + `pnpm build` + `pnpm test`.
- [ ] **Step 5: Commit** — `feat(v3): server actions de selección de referencias por clip`.

---

### Task 4: Diálogo de referencias por clip en el tablero

**Files:**
- Modify: `components/campaigns/ReferencePoolDialog.tsx`, `components/campaigns/CampaignStudioView.tsx`

**Interfaces:**
- `ReferencePoolDialog` props: añade un modo por-ítem. Nueva forma de props (discriminada o con `itemId` opcional): `{ campaignId: string; itemId?: string; context?: 'video' | 'storyboard'; trigger?: React.ReactNode }`. Si `itemId` está presente, usa `getItemReferencePoolAction(itemId)` / `setItemReferenceSelectionAction({ itemId, include })`; si no, el flujo de campaña actual (`getReferencePoolAction`/`setReferenceSelectionAction`).

- [ ] **Step 1: `ReferencePoolDialog.tsx`** — parametriza las dos server actions según `itemId`. El resto de la UI (categorías, thumbnails, toggles, cap, reset) es idéntico — solo cambian las dos funciones de carga/guardado y el título ("Referencias de este clip" vs "Referencias de la campaña"). Permite un `trigger` custom para el botón por-fila.
- [ ] **Step 2: `CampaignStudioView.tsx` — botón por clip**: en `PlanTable`, junto a `renderProductSelector(item)` (~890-922, usado en `renderPlanRow` ~957 y en las filas de escena), añade `<ReferencePoolDialog campaignId={campaign.id} itemId={item.id} trigger={<Button variant="ghost" size="sm">Referencias</Button>} />`. Muestra un indicador sutil si el ítem tiene selección manual (badge "manual") vs automático. (El diálogo de campaña del top bar se queda como "default general"; no lo quites.)
- [ ] **Step 3: Verificar** — `pnpm typecheck` + `pnpm build` + `pnpm lint` (0 errores).
- [ ] **Step 4: Commit** — `feat(v3): diálogo de referencias por clip en el tablero del studio`.

---

## Cierre de fase

Review final de rama (delta Fase 4). Smoke del usuario: en una campaña multi-producto, abrir "Referencias" de un clip → el pool muestra el producto/activos de ESE clip (no un agregado de la campaña) → personalizar y verificar que la generación de ese clip respeta la selección, y que otro clip con su propia selección no se ve afectado. **Con esto la feature V3 multi-producto queda completa** (Fases 1-4). Limpieza pendiente (no bloqueante): endurecer RLS `campaign_products_insert`; `merge_sequence`/`generateSeriesAction` propaguen `product_id`; deprecar `campaigns.reference_selection`/`product_brief` tras confirmar que nada los necesita.
