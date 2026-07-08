# Fase O — Ingesta de prompt maestro (monolítico → campaña estructurada)

> **~1.5–2 días · híbrido: capa de ingesta + fixes de topes aguas abajo**
>
> El usuario pega un **prompt maestro** completo (estilo Veo/Sora: estética global, medidas del
> producto, locaciones, talento, guion por clips, transiciones) y una capa previa con Gemini Flash
> lo **reparte** en los slots estructurados que la plataforma ya maneja (ficha de producto, estilo
> visual, guías creativas, Cast) más un guion por clip limpio para el matcher. Todo se **pre-llena
> editable**; nada se genera ni se sobrescribe sin que el usuario confirme. Origen: reframe del
> usuario 2026-07-06 — el prompt maestro es monolítico, la plataforma es composicional, y hoy la
> mayor parte del prompt se cae en silencio. Diseño validado el 2026-07-06.

## Contexto y decisión de diseño central

Hoy, si el usuario pega un prompt maestro en el campo de ideas del wizard, gran parte se pierde por
diseño:

- El input se **rechaza** si supera 6000 chars (`lib/schemas/campaigns.ts:123`,
  `userIdeas.max(6000)`) o se **trunca** en el matcher (`format-matcher.ts:537`, `slice(0, 6000)`).
- Un guion de >8 clips se **mutila**: `scenes.slice(0, 8)` (`format-matcher.ts:161`) y
  `maxOutputTokens: 4000` (`:551`).
- Las medidas/material del producto escritas en el prompt las **ignora** el matcher a propósito
  (regla PRODUCTO INTOCABLE, `format-matcher.ts:317`): el producto tiene **una sola fuente de
  verdad, la ficha**.
- La estética global (UGC), el safe 4:5 y las transiciones no se controlan por texto de idea: son
  campos estructurados (`visual_style`, `creative_guidelines`) o conceptos de montaje.

**La ingesta disuelve el desajuste sin romper los invariantes:** en vez de forzar al matcher a
tragarse un monolito, un pre-paso **extrae** los elementos estructurados hacia sus slots reales y
deja al matcher un **guion narrativo limpio** (lo que ya sabe procesar). El usuario **revisa** el
reparto antes de generar.

### Invariantes arquitectónicos (no rediseñar sin confirmar)

- **PRODUCTO INTOCABLE se mantiene intacto.** La descripción fina del producto sobrevive **por la
  ficha** (`visualDetails` + medidas), NO metiéndola al `scenePrompt`. El matcher sigue sin
  re-describir el producto — así se evita la contradicción clásica ("framed canvas" cuando es sin
  marco). La ficha ahora lleva *la descripción del usuario* en vez de solo la auto-detectada.
- **La IA no inventa atributos del producto.** La descripción fina la escribió **el usuario**
  (aserción del cliente, no invención de la IA); el auto-brief (`analyzeProductBrief`) sigue con su
  prohibición de inventar. La UI distingue "detectado de la imagen" vs "de tu prompt".
- **Nada se sobrescribe en silencio.** La ingesta PRE-LLENA campos editables; el usuario confirma.
  Misma filosofía que el brief editable de spec 08.
- **Se reusa el matcher, no se reemplaza.** La ingesta produce un guion narrativo que entra al
  `matchIdeas` existente; el matcher hace el split en escenas, la dirección de cámara, el guionizado
  de diálogo y el saneo. Una sola tubería de generación.
- **Nada renderiza transiciones.** Los clips son generaciones Seedance independientes. Las
  "transiciones motivadas" sobreviven como **beats de entrada/salida por clip** (el clip queda listo
  para el corte); el montaje lo hace el usuario.

## Objetivo

Al cerrar la fase, desde el wizard de campaña el usuario puede **pegar un prompt maestro completo**,
ver cómo se reparte en ficha de producto, estilo visual, guías creativas, avisos de Cast/locaciones
y un guion por clip — todo editable — y, tras confirmar, generar un plan que **respeta** lo que
escribió: medidas y descripción fina del producto en la ficha, look UGC como estilo `casero`, safe
4:5 como guía, y un guion de hasta ~15 clips con beats de transición, sin mutilarse por topes.

## Estructura

```
lib/campaigns/
  ingest.ts             ← Gemini Flash: prompt maestro → IngestResult. server-only.
                          Patrón brief.ts/format-matcher.ts (fetch directo, JSON, thinkingBudget 0).
lib/schemas/
  ingest.ts             ← zod del contrato IngestResult + input.
server-actions/
  campaigns.ts          ← ingestMasterPromptAction() (nueva); generatePlanAction (topes).
components/campaigns/
  CampaignStudioWizard.tsx  ← paso "Pegar prompt maestro" + pre-llenado editable + avisos.
supabase/migrations/
  0NN_transition_hint.sql   ← campaign_items.transition_hint text null (único cambio de BD).
```

Modificados sin cambio de contrato externo: `lib/prompt-director/format-matcher.ts` (topes +
cláusula de beats de transición en el SYSTEM), `lib/schemas/campaigns.ts` (tope `userIdeas`).

## Contrato (`lib/schemas/ingest.ts`)

La ingesta corre **antes de crear la campaña** (el gate de revisión es previo a generar), así que
no hay `campaignId` ni brief todavía. El `inCast` se resuelve contra el Cast del **workspace** (la
action lo consulta, no confía en el cliente). El merge de `productVisualDetails`/`productFacts` con
el brief auto-detectado ocurre en `createCampaignStudioAction` **al crear** (no en la ingesta).

```ts
// Entrada: solo el prompt maestro crudo (la action añade el Cast del workspace).
type IngestInput = {
  masterPrompt: string;   // libre, cap holgado (ver tarea 5): MASTER_PROMPT_MAX = 60000
};

// Salida estructurada de Gemini Flash (una sola ronda, zod laxo).
type IngestResult = {
  // Datos físicos que el usuario ESCRIBIÓ (no inventados). Ausente = no lo mencionó.
  productFacts: {
    heightCm?: number; widthCm?: number; weightKg?: number;
    thicknessMm?: number; medium?: string;
  };
  // Descripción visual fina del producto → merge editable con visualDetails de la ficha.
  productVisualDetails: string | null;
  // SUGERENCIA de perfil (p. ej. 'casero' si la estética es UGC/smartphone); null si no infiere.
  // NO se aplica sola: la UI la marca en el selector y el usuario elige.
  visualStyle: VisualStyle | null;
  // Guías creativas inferidas del prompt (safe 4:5, producto completo, hook héroe).
  guidelines: { safeCrop?: '4:5' | null; showFullProduct?: boolean; hookProductHero?: boolean };
  // Personas nombradas: si están en el Cast se ligan; si no, aviso (identidad driftea).
  castHints: Array<{ name: string; inCast: boolean; note: string }>;
  // Locaciones descritas: aviso para cargarlas como Locaciones base (no se auto-crean).
  locationHints: string[];
  // El guion por clip, LIMPIO, en el idioma del usuario → alimenta el matcher tal cual
  // (una escena por clip; sin medidas del producto, sin estética global — ya repartidas).
  narrative: string;
  // Avisos legibles para el wizard (ej. "detecté 9 clips; revisa que quepan", "sin Cast...").
  warnings: string[];
};
```

## El reparto (qué extrae la ingesta → a dónde va)

| Del prompt maestro | Destino en la plataforma | Nota |
|---|---|---|
| Estética UGC / iPhone (§1) | **sugiere** `casero` en el selector (el usuario elige) | look smartphone real (`style-profiles.ts:83`) |
| Safe 4:5 + franjas (§2) | `creative_guidelines.safeCrop='4:5'` | detalle de franjas → toggle + cláusula, no literal |
| Medidas/peso/material (§6) | Ficha: `heightCm/widthCm/weightKg/thicknessMm/medium` | del usuario, no inventado |
| Descripción visual fina | **`visualDetails` de la ficha** (merge editable) | resuelve "físicas"; PRODUCTO INTOCABLE intacto |
| Talento (§4) | Liga al Cast si lo nombra; si no, **aviso** | sin personaje del Cast la identidad driftea |
| Locaciones (§3) | **Aviso**: cargar como Locaciones base | no se auto-crean |
| Acciones + diálogo por clip (§7) | `narrative` → matcher (una escena por clip) | el matcher hace el split y la cámara |
| Grade cálido / acento amarillo (§5) | Repetido por clip en el `narrative` + aviso | no hay grade global; el acento se repite |
| Transiciones motivadas (§5) | Beats de entrada/salida por clip (tarea 6) | el clip queda listo para el corte |

## Tareas en orden

### 1. `lib/schemas/ingest.ts` + `lib/campaigns/ingest.ts` (4h)

Módulo Gemini Flash (mismo patrón que `brief.ts`/`format-matcher.ts`: fetch directo,
`responseMimeType: 'application/json'`, `thinkingBudget: 0`, un reintento ante `retryable`, zod
laxo — un campo malformado no tira el resultado). El SYSTEM prompt instruye:

- **Repartir, no reescribir el mundo.** Extraer medidas/material a `productFacts`, la descripción
  visual fina a `productVisualDetails`, la estética a `visualStyle`, el safe/encuadre a `guidelines`.
- **No inventar datos del producto** que el prompt no diga (mismo criterio que el brief).
- **`narrative`:** devolver SOLO el guion por clip, en el idioma del usuario, **sin** las medidas
  del producto ni la estética global (ya repartidas) — para que el matcher no las duplique ni
  contradiga. Conservar diálogo, acciones y orden de clips.
- **`castHints`/`locationHints`:** nombrar personas y lugares descritos; marcar `inCast` contra la
  lista de Cast que se pasa en el prompt (ids/nombres, como el matcher).
- **`warnings`:** contar clips y avisar si son muchos; avisar de talento sin Cast, locaciones sin
  cargar, transiciones que requieren montaje.

Recibe (además del `masterPrompt`) los **nombres del Cast del workspace** para resolver `inCast`.
NO hay brief aún (la ingesta es pre-creación): `productVisualDetails`/`productFacts` se devuelven tal
cual y se **mergean** con el brief auto-detectado en `createCampaignStudioAction` (tarea 8). Sin
`GEMINI_API_KEY` → `ProviderError` auth.

### 2. `server-actions/campaigns.ts` — `ingestMasterPromptAction` (1.5h)

`ingestMasterPromptAction(input: unknown): Promise<Result<IngestResult>>`. Valida con el schema,
`requireWorkspace()`, **carga los nombres del Cast del workspace** (para `inCast`), llama a
`ingest.ts`. **Falla blanda:** si Gemini falla, devuelve un `IngestResult` con `narrative` = el
prompt crudo saneado y el resto vacío, más un `warning` — el wizard sigue manual, no bloquea.
**No persiste nada** aquí: solo devuelve la propuesta; el guardado ocurre cuando el usuario confirma
(reusa `createCampaignStudioAction` con los overrides + `generatePlanAction`).

### 3. UI del wizard — paso "Pegar prompt maestro" (4h)

En `CampaignStudioWizard.tsx`, nueva entrada opcional (toggle o paso previo al de ideas): textarea
grande + botón "Analizar". Al volver el `IngestResult`:

- **Pre-llena editable:** ficha (medidas + `visualDetails` con merge marcado "de tu prompt" vs
  "detectado"), selector de estilo con la **sugerencia marcada pero NO aplicada** (el usuario
  elige; si no acepta la sugerencia, el estilo queda como estaba), toggles de guías
  (`safeCrop`, `showFullProduct`, `hookProductHero`), y el `narrative` en la textarea de ideas.
- **Avisos** (no bloqueantes): `castHints` sin Cast ("Marta no está en tu Cast → su identidad
  cambiará entre clips; créala o asígnala"), `locationHints` ("carga estas 2 locaciones como base
  para consistencia"), y los `warnings` (conteo de clips, transiciones para montaje).
- El usuario edita lo que quiera y pulsa **Generar plan** → `generatePlanAction` con el `narrative`
  editado como `userIdeas` (flujo actual, sin cambios de contrato).

La ingesta (Gemini Flash) **no cobra créditos** (patrón brief/clarify).

### 4. Fixes de topes aguas abajo (1.5h)

Para que un guion largo no se mutile — **los tres juntos**, subir solo el char cap no basta:

- `lib/schemas/campaigns.ts:123` — `userIdeas.max(6000)` → subir (p. ej. 24000). Es un **rechazo**
  hoy, no un truncado.
- `format-matcher.ts:537` — `ideasText.slice(0, 6000)` → alinear con el nuevo tope.
- `format-matcher.ts:161` — `scenes.slice(0, 8)` → subir a **16** (cubre guiones de ~9–15 clips;
  el techo real del plan sigue en `MAX_PLAN_ITEMS = 30`).
- `format-matcher.ts:588` — `matches.slice(0, 8)` → revisar/subir en el mismo criterio.
- `format-matcher.ts:551` — `maxOutputTokens: 4000` → subir (p. ej. 8192) para que N escenas con
  diálogo no trunquen el JSON.

Sin datos de proveedor en tests (regla del repo): validar los nuevos topes con fixtures, no con API.

### 5. Cap del `masterPrompt` (0.5h)

El input de la ingesta es su propio campo (no `userIdeas`): cap holgado en el schema y en la
textarea. Gemini 2.5 Flash tiene contexto de sobra; el cap solo atrapa pegados patológicos.

> **Actualización 2026-07-07:** el cap subió de 24000 a **60000** (`MASTER_PROMPT_MAX`, exportado
> desde `lib/schemas/ingest.ts` como única fuente de verdad) porque los briefs reales llegan en
> varios archivos (~50k chars juntos). Consumen la constante: el schema de input, el slice
> pre-Gemini de `lib/campaigns/ingest.ts`, el slice del matcher, `userIdeas` y las dos textareas
> del wizard. `maxOutputTokens` de la ingesta subió de 8192 a 32768: el narrative devuelve el
> guion casi íntegro y con prompts cerca del cap el JSON se truncaba y todo caía al fallback.

### 6. Beats de transición en el matcher + `transition_hint` (2h)

- **SYSTEM del matcher** (`format-matcher.ts`): añadir cláusula gateada — cuando el guion pide una
  transición motivada entre escenas, cada escena nombra su **beat de cierre** (el gesto/encuadre
  sobre el que cae el corte) y la siguiente su **beat de apertura** coherente. Es dirección dentro
  del `scenePrompt` (el matcher ya escribe cámara); no un motor de transiciones.
- **Migración** `0NN_transition_hint.sql`: `alter table campaign_items add column if not exists
  transition_hint text;` (nullable). El matcher puede devolver una nota corta por escena
  (`SceneSchema.transitionHint`, opcional, zod laxo) que el planner persiste; la UI la muestra en la
  vista de edición ("corta sobre: ella gira hacia el jardín"). **Aplicar la migración vía MCP ANTES
  de pushear** código que lea la columna (orden migración→push).

### 7. Tests (1h)

Unit con fixtures, **sin APIs reales**:

- `ingest.ts`: parseo/saneo (fences markdown, campos faltantes, no-string), reparto correcto
  (medidas → `productFacts`, no al `narrative`), `inCast` contra el pool, fallback best-effort.
- schemas zod de `ingest.ts` (input cap `MASTER_PROMPT_MAX`, salida laxa).
- Topes nuevos del matcher (8→16 escenas; input no se rechaza a 6000).
- `transition_hint` opcional no tira el match.

Smoke manual (usuario): pegar el prompt maestro real de Proliénzo, revisar el reparto, generar y
verificar que las medidas están en la ficha, el selector **sugirió** `casero`, y salen ~9 clips (no 8).

## Errores y guardas

- Ingesta Gemini falla → `narrative` = prompt crudo saneado + `warning`; wizard manual (no bloquea).
- Nada se persiste hasta que el usuario confirma; nada se sobrescribe sin mostrarlo editable.
- Producto: la descripción fina es del usuario; el auto-brief conserva su prohibición de inventar.
- Guion de >16 clips: se procesa hasta 16 y se **avisa** en `warnings` (no se recorta en silencio).
- Migración `transition_hint` aplicada vía MCP antes del push (si no, 500 en prod al leer la columna).

## Criterio de cierre

- `pnpm typecheck`, `pnpm build` y tests verdes.
- Pegar un prompt maestro largo (>6000 chars, 9 clips): NO se rechaza; se reparte en ficha
  (medidas + `visualDetails`), una **sugerencia** de estilo (`casero`), guías (`safeCrop`), avisos
  de Cast/locaciones, y un guion editable.
- Tras confirmar, el plan sale con **9 clips** (no 8), cada uno con beat de entrada/salida cuando el
  guion pedía transición; las medidas y la descripción fina viven en la ficha, no re-descritas en el
  `scenePrompt`.
- Revisión manual: la ingesta nunca inventa atributos del producto ni sobrescribe config previa sin
  mostrarla; sin Cast asignado, el aviso de drift de identidad es visible.
