# Diseno: mover la generacion de paneles del storyboard al worker QStash

Fecha: 2026-06-30
Estado: aprobado (pendiente de plan de implementacion)

## Problema

La generacion de paneles del storyboard corre **inline** en un server action
(`generatePanelAction` / `refinePanelAction`): llama a Nano Banana y, en modo estricto,
a FLUX.1 Expand, de forma sincrona, y solo retorna cuando termina. Las funciones de la
app estan capadas a **60s (Vercel Hobby)**. El path estricto hace **dos generaciones Pro
secuenciales** (Nano ~15-30s + FLUX expand ~10-40s); la suma se acerca o pasa de 60s, y
Vercel mata la funcion dejando la generacion colgada en `processing`. El sintoma que se
observo fue "FLUX expand timeout" (nuestro poll de 30s) y, con cargas mayores, riesgo de
kill por 60s.

Esto ademas **viola la decision arquitectonica inmutable** de CLAUDE.md: "todo lo que
tarde >60s pasa por QStash" y "`/api/jobs/process` es el unico endpoint backend de
generacion". El storyboard inline es la unica generacion que se salta el worker.

## Decision

Mover **toda** la generacion de paneles del storyboard (estricta y no estricta) al worker
QStash, siguiendo el patron ya usado por los handlers de video/audio (submit -> poll
re-encolado -> finalize/fail). El server action solo **encola**; el worker genera; el
cliente escucha por **Realtime**.

Enfoque del expand (aprobado, "B"): el FLUX expand corre **entero dentro de una sola
invocacion del worker** (submit+poll+download), separado de Nano en otra invocacion. No
se parte el adapter en submit/poll con re-encolado (seria sobre-ingenieria para una
operacion de segundos, no minutos como el video). Cada invocacion del worker queda
holgada en 60s: Nano sola, luego expand solo.

## Flujo end-to-end

```
generatePanelAction / refinePanelAction  (server action, siempre <60s):
  1. validar + compilar prompt + resolver referencias/prevTurn        (como hoy)
  2. insert generations(status='processing', provider='nano-banana',
       prompt=<panelPrompt>, params.storyboard={...payload...},
       timeout_at = now + 5min)
  3. reserveCredits(user, cost, generationId)   (passes:2 si estricto)
     - si falla enqueue despues: refund + delete fila (rollback)
  4. enqueueJob({ generationId, action:'submit' })
  5. return { ok:true, data:{ generationId, status:'processing' } }   <- inmediato

worker /api/jobs/process  -> dispatchJob -> handler 'nano-banana':
  action='submit':
    generateNanoBanana(<reconstruido del payload>)          (~15-30s)
    - no estricto -> { kind:'finalize', outputBuffer, mimeType,
                       metadata:{ thought_signature } }
    - estricto    -> uploadSafeBase(base 4:5)
                     providerPayload = { thought_signature, safe_base_path }
                     { kind:'continue', delaySeconds: 0 }   (re-encola action='poll')
  action='poll'  (solo estricto):
    descarga safe_base_path -> expand(base)                 (~10-30s, timeout interno ~50s)
    { kind:'finalize', outputBuffer(9:16), mimeType,
      metadata:{ thought_signature, safe_base_path } }

  finalize (worker): uploadOutput + completeGeneration (confirma creditos) +
                     [storyboard post-step] promoteOutputToReference +
                     update campaign_items.storyboard_image_id/generation_id
  fail (worker):     failGeneration (refund si no confirmado) + status='failed' + error_message

cliente StoryboardView:
  action retorna generationId -> panel 'generating' -> se suscribe a Realtime en
  generations(id) -> 'done' => router.refresh(); 'failed' => error con motivo.
```

## Componentes

### 1. Server actions (`server-actions/storyboard.ts`)

`generatePanelAction` y `refinePanelAction` dejan de generar inline. Cada uno:

- Mantiene validacion, compilacion del prompt, resolucion de referencias y `prevTurn`
  (incluida la logica de cadena con `safe_base_path` y el break por locacion).
- Serializa un **payload autocontenido** en `params.storyboard` (ver seccion 2).
- Inserta la fila `generations` con `status='processing'`, `provider='nano-banana'`,
  `prompt=<panelPrompt>`, `timeout_at = now + 5min`.
- Reserva creditos (`reserveCredits`, `passes:2` si estricto).
- Encola `enqueueJob({ generationId, action:'submit' })`.
- **Rollback**: si `enqueueJob` lanza tras reservar, hace `refundCredits`/`failGeneration`
  y borra (o marca failed) la fila, para no dejar creditos en `pending`.
- Retorna `{ ok:true, data:{ generationId, status:'processing' } }` de inmediato.

Se **elimina** de ambos actions: la llamada inline a `generateNanoBanana`, a
`extendPanelTo916`, el `uploadOutput`/`uploadThumbnail`/`completeGeneration` inline y el
`promoteOutputToReference`+update de `campaign_items` (todo eso pasa al worker/finalize).

### 2. Payload del job (`params.storyboard`)

El worker reconstruye la llamada a Nano SOLO desde la fila `generations`. El action
resuelve todo y lo guarda:

```ts
type StoryboardJobPayload = {
  campaignItemId: string;
  genAspect: string;              // '4:5' en estricto, si no el aspecto del item
  strict: boolean;                // strictSafe
  isOpeningBeat: boolean;
  referencePaths: { storagePath: string; kind: 'image'; role?: string }[];
  prevTurn:
    | null
    | { imagePath: string; mimeType: string; thoughtSignature?: string; prompt: string };
  chatRefPaths: { product?: string[]; character?: string[] };  // rutas ya resueltas por flag
  useGrounding: false;
  hasTextInImage: false;
};
```

- `prompt` compilado va en `generations.prompt` (no en el payload).
- Las rutas de referencia y de `prevTurn`/chat son **paths de storage** (el worker las
  descarga con `downloadReferenceBuffer`/`downloadOutputBuffer`), no buffers.
- En estricto, `prevTurn.imagePath` es el `safe_base_path` de la generacion previa
  (invariante del fix de cadena: la cadena estricta replaya la base 4:5 de Nano, que
  calza con el `thought_signature`).
- El action ya resolvio chained-vs-fresh, por lo que el `prompt` guardado es consistente
  con el `prevTurn` del payload.

### 3. Handler `nano-banana` (`lib/jobs/handlers/nano-banana.ts`)

Nuevo handler registrado en `lib/jobs/handlers/register.ts`
(`registerHandler('nano-banana', nanoBananaHandler)`). Implementa el contrato de los
handlers existentes: `handle(gen, action) -> { kind:'continue'|'finalize'|'fail', ... }`.

- `action==='submit'`:
  - Reconstruye `NanoBananaParams` desde `gen.prompt` + `gen.params.storyboard`
    (descarga `referencePaths`, `prevTurn.imagePath`, `chatRefPaths`).
  - Llama `generateNanoBanana(params)`.
  - No estricto: `{ kind:'finalize', outputBuffer:res.buffer, mimeType:res.mimeType,
    metadata:{ thought_signature: res.thoughtSignature } }`.
  - Estricto: `uploadSafeBase(workspace, generationId, res.buffer, res.mimeType, ext)`,
    guarda `provider_payload={ thought_signature, safe_base_path }` (el worker persiste el
    `providerPayload` que retorna el handler en `continue`), y
    `{ kind:'continue', delaySeconds:0 }` (re-encola como `poll`).
- `action==='poll'` (solo estricto):
  - Descarga `safe_base_path` (de `gen.provider_payload`).
  - `expand(base)` -> `{ kind:'finalize', outputBuffer, mimeType,
    metadata:{ thought_signature, safe_base_path } }`.
- Errores de proveedor (moderado, timeout, 402, etc.) -> `{ kind:'fail', message, code }`
  (los `ProviderError` de Nano/FLUX se mapean a `fail`; el worker refunda).

`MAX_POLLS = 2` (el estricto hace 1 poll). `flux-expand.ts`: subir `POLL_TIMEOUT_MS` de
30s a ~50s (ahora corre solo en una invocacion de 60s; 50s deja margen para el
submit/download y evita el kill por 60s). `POLL_INTERVAL_MS` puede subir a 1000ms.

### 4. Finalize del storyboard (worker)

El `finalize` generico (`lib/jobs/finalize.ts`) ya hace `uploadOutput` +
`completeGeneration` (confirma creditos). Dos cosas a asegurar:

**Persistencia del `provider_payload`.** El `finalize` debe guardar en
`generations.provider_payload` el `metadata` que retorna el handler
(`thought_signature`, y `safe_base_path` en estricto). Es CRITICO para la cadena: el
proximo beat encadenado lee `thought_signature` (y `safe_base_path`) del panel previo. En
estricto ambos ya quedan persistidos en el paso `submit->continue`; en no estricto NO hay
`continue`, asi que el `thought_signature` debe persistirse en el `finalize` desde
`metadata`. Verificar que la ruta de finalize del worker pase el `metadata` a
`completeGeneration` como `provider_payload` (hoy los handlers de video pueden no
necesitarlo; el de nano-banana si).

**Post-step del storyboard** que hoy vive en el action: `promoteOutputToReference` + update de
`campaign_items.storyboard_image_id`/`storyboard_generation_id`. Se agrega como paso
posterior consciente del tipo (mirroring el `advance_chain` de video en
`app/api/jobs/process/route.ts`): cuando la generacion finalizada tiene
`params.storyboard.campaignItemId`, tras `completeGeneration` se promueve el output a
`media_reference` y se actualiza el `campaign_item`. Best-effort (log en error, no rompe
la generacion ya `done`).

**Correccion (2026-07-01): el promote va en su PROPIO job QStash, no inline.** Correrlo
inline tras `finalize` sumaba download+upload+insert a una invocacion que en estricto ya
gastaba ~50s en el FLUX expand; se observo un `504 Task timed out after 60 seconds` que
mataba la funcion despues de escribir `status=done` pero antes de enlazar el
`campaign_item` -> panel huerfano (output en storage, sin `media_reference` ni enlace, el
beat seguia apuntando al panel previo). Fix: el `finalize` encola un job
`action:'promote_storyboard'` (delay 0) cuando la gen es de storyboard; ese job corre
`promoteOutputToReference`+enlace con presupuesto fresco de 60s y luego re-emite el evento
Realtime (UPDATE idempotente `status='done'`) para que el cliente refresque con el panel
ya enlazado (el `done` del finalize se disparo antes de existir el enlace).

### 5. Cliente (`components/campaigns/StoryboardView.tsx`)

- `handleRegenerate` / generar-todos: llaman al action, que ahora retorna
  `{ generationId, status:'processing' }`. Se pone el panel en `generating` y se guarda
  `beatId -> generationId`.
- **Suscripcion Realtime** a `postgres_changes` en `generations` (filtrado por
  `campaign_id` de la campana, o por los `generationId` en vuelo), con el patron
  `setAuth` para RLS (`@supabase/ssr` + `postgres_changes`).
- `status==='done'` -> `router.refresh()` (trae el `panelUrl`) + panel a `idle`.
- `status==='failed'` -> panel a `error` con mensaje segun `error_message`/code
  (moderado -> "el proveedor rechazo la imagen; reintenta o desactiva la zona segura
  estricta"; timeout -> "tardo demasiado, reintenta"; generico si no).
- **Reconciliacion al montar**: consultar generations en `processing` de los beats de la
  campana y suscribirse, para sobrevivir a una recarga (hoy el inline se perdia).
- **Generar todos**: encola N jobs; se siguen N generations por Realtime; cada una
  finaliza independiente.
- **Broadcast acotado por columnas** (migracion 050): `generations.provider_payload`
  guarda el `thought_signature` de gemini-3-pro-image (~6-9 MB), que excede el
  `max_record_bytes` de Realtime (1 MB). Sin acotar, el UPDATE de `finalize` se difunde
  con el `record` vacio (413) y el cliente nunca recibe el `done` -> el panel se queda
  "generando" hasta un reload. La publicacion `supabase_realtime` publica solo las
  columnas que los hooks leen (`id, status, error_message, output_url, thumbnail_url,
  credits_charged, campaign_id, params`); `provider_payload` sigue en la tabla para el
  encadenado conversacional server-side, pero fuera del broadcast.

## Manejo de errores / creditos

- Reserve en el action (antes de encolar). Confirm en el `finalize` del worker
  (`completeGeneration`). Refund en el `fail` (`failGeneration`, idempotente: no-op si ya
  confirmado). RPCs atomicas, sin tocar tablas de creditos directo.
- **Rollback de encolado**: si `enqueueJob` falla tras reservar, el action refunda y
  elimina/falla la fila.
- `timeout_at` (~5 min) + `MAX_POLLS=2` acotan el job. Si `timeout_at` vence, el worker
  falla + refunda (ruta existente en el worker).
- La politica **"fallar limpio"** del estricto queda inherente: un fallo del expand
  (moderado/timeout) es un `fail` del worker; nunca se guarda un 4:5 mal etiquetado. El
  guard no-op de `centralSafeCrop` (<=4:5) se conserva como defensa.

## Testing

- **Handler** (`lib/jobs/handlers/nano-banana.test.ts`): con Nano/FLUX **mockeados** (sin
  APIs reales), verificar: no estricto -> `finalize` en `submit`; estricto -> `continue`
  en `submit` (con `safe_base_path` en providerPayload) y `finalize` en `poll`; un
  `ProviderError` -> `fail`.
- **Serializacion del payload**: funcion pura que arma `params.storyboard` desde el
  contexto del action -> test determinista (rutas, genAspect, strict, prevTurn).
- Geometria (`safe-area`), adapter (`flux-expand buildExpandBody`), guidelines,
  estimador: tests existentes se conservan.
- **Sin APIs reales en tests**. El smoke real (Nano + FLUX de verdad, cadena estricta,
  moderacion/timeout como `fail`) lo corre el usuario.
- Verificacion: `pnpm typecheck`, `pnpm lint`, `pnpm build`, vitest de lo tocado.

## Fuera de alcance

- Partir `flux-expand.ts` en submit/poll con re-encolado (enfoque "A") — reservado por si
  BFL encola de forma cronica.
- La deriva de producto de fondo en cadena (`refSlots=0`, anclaje por texto) — palanca B
  pendiente, issue aparte ([[project_zona_segura_abandonada]]).
- Cambiar el modelo de la base (sigue Nano) o el proveedor del expand (sigue BFL FLUX.1
  Expand).

## Constraints

Sin emojis (UI). No `any` (usar `unknown` + narrowing o tipo explicito). pnpm. Commits
sin `Co-Authored-By`. Sin BOM. Clausulas de prompt ASCII. URLs de proveedor NUNCA al
cliente (el worker descarga y sube a Supabase; solo URLs internas). Service role solo
server-side. `'use server'` solo exporta funciones async. Creditos solo via RPCs atomicas
(`reserve`/`confirm`/`refund`). Realtime con `setAuth` para RLS. Migraciones (si hubiera)
via MCP antes de pushear codigo que lea columnas nuevas; este diseno **no** requiere
migracion (reusa `generations.params`/`provider_payload` jsonb y el flag `safeAreaExtend`).
El worker sigue `.cursor/rules/40-worker.mdc`; los adapters `.cursor/rules/30-providers.mdc`.
