# Diseno: zona segura 9:16 por outpaint con mascara (FLUX.1 Expand)

Fecha: 2026-06-30
Estado: aprobado (pendiente de plan de implementacion)

## Problema

Se necesita un panel de storyboard **9:16** donde el producto y la mayor parte del
personaje queden dentro del **4:5 central**, porque el video se usa en 9:16 **y** se
recorta a 4:5 para algunas plataformas: ambos formatos deben ser reales y nitidos.

Los enfoques previos fallaron (ver
`2026-06-30-zona-segura-extendida-9x16-design.md`, "Revision final"):
- Texto solo (clausula fuerte de 4:5): mejor-esfuerzo; el producto se sale del 4:5
  o, al pedirlo mas chico, pierde la escala real frente al personaje.
- Extension generativa con Nano (pin / sin-pin / banda relajada / prompt simple /
  guia verde): costura, deriva, rebanado, franja negra, o el modelo dibuja la guia.

Causa raiz: el proveedor de imagen (Nano / FLUX 2 Pro) **regenera la imagen
completa**; no hace outpaint con mascara (rellenar solo bandas dejando el centro
intacto). Sin eso no se puede tener 9:16 nitido + 4:5 exacto a la vez.

## Decision

Usar **outpaint con mascara real** via **BFL FLUX.1 Expand** (`/v1/flux-pro-1.0-expand`):

1. Generar el panel en **4:5** con Nano (igual que hoy en modo estricto base). El
   frame 4:5 ES la zona segura, asi que el producto sale completo y a **escala
   natural** (llena el cuadro a su tamano real, sin encogerse).
2. **Expandir** ese 4:5 a 9:16 con FLUX.1 Expand: se le pasa la imagen + cuantos
   pixeles agregar arriba y abajo (`top`, `bottom`); **preserva los pixeles
   originales** y genera bandas nitidas y coherentes.

Garantias:
- **4:5 recortado** = la base exacta (producto completo, a escala, nunca recortado).
- **9:16** = base + bandas reales y nitidas (sin desenfoque, costura dura, verde ni
  negro).
- Sin deriva del centro (expand conserva la entrada), sin rebanado.

## Probe-first (gate antes de construir todo)

FLUX.1 Expand es un endpoint **distinto** al `flux-2-pro-preview` que el repo usa
hoy; usa la misma cuenta y `BFL_API_KEY`, pero no esta confirmado que la cuenta lo
tenga habilitado. **No** se puede verificar desde aqui (no se llama a APIs reales).

Primer paso del plan: un script standalone (`scripts/probe-flux-expand.mjs`) que el
USUARIO corre. Hace un POST minimo a `/v1/flux-pro-1.0-expand` con una imagen de
prueba (generada local con sharp) y `top`/`bottom` chicos, y reporta:
- `Ready` (o un `polling_url` valido) -> el endpoint existe; se sigue con el resto.
- `404` / `403` / `Not Found` -> no disponible; se PIVOTEA (endpoint `fill` con
  mascara construida, o fal.ai) antes de invertir en la integracion.

El script no imprime la key. Si el probe falla, el resto del plan no se ejecuta tal
cual: se re-disena el adapter sobre el endpoint que si exista.

## Flujo (modo estricto ON, aspect 9:16)

```
Nano genera el panel en 4:5 (producto completo, a escala, escena)
  -> FLUX.1 Expand(base4x5, top=bandPx, bottom=bandPx) -> 9:16 nitido
  -> subir como output del panel
```

Encadenado: el 9:16 guardado se recorta a su 4:5 central (`centralSafeCrop`) para
alimentar el turno conversacional de la base del siguiente beat (misma logica que
tenia el extend original). Aplica a `generatePanelAction` y `refinePanelAction`.

## Componentes

### 1. Adapter `lib/providers/flux-expand.ts`

- POST a `${BFL_BASE}/v1/flux-pro-1.0-expand` con header `x-key: $BFL_API_KEY`.
- Body: `image` (base64 raw, sin prefijo data:), `top`, `bottom` (px; `left`/`right`
  = 0), `prompt` (continuacion de escena), `output_format: 'jpeg'`, `safety_tolerance`.
- Mismo patron submit + poll que `flux.ts`: respuesta da `id` + `polling_url`; se
  hace polling GET cada 500ms hasta `status: 'Ready'`; se descarga `result.sample`
  inmediatamente (URLs expiran ~10 min). Reusa los mismos timeouts/limites que
  `flux.ts`.
- Errores tipados con `ProviderError` (auth/rate_limit/server/invalid_input), igual
  que los otros adapters. 429 con backoff; 402 = creditos insuficientes; 404/`Not
  Found` = endpoint no disponible (accionable).
- `buildExpandBody(params)` exportada para test determinista (no llama a red):
  verifica que el body lleva la imagen, los `top`/`bottom` correctos y el prompt.

### 2. Geometria `lib/images/safe-area.ts` (re-creada minima)

- `safeAreaBands(width)`: `{ bandPx, canvasHeight }` para un 4:5 de ancho `width`
  dentro de un 9:16 (misma formula que antes: `canvasHeight = round(width*16/9)`,
  `baseHeight = round(width*5/4)`, `bandPx = round((canvasHeight-baseHeight)/2)`).
- `centralSafeCrop(panel916)`: recorta el 4:5 central de un 9:16 (para la cadena).
- NO se re-crean `composeOnto916`/`pinCenter` (el expand no compone bandas negras;
  toma la base cruda + padding).

### 3. `extendPanelTo916` en `server-actions/storyboard.ts` (re-introducida)

- Recibe la base 4:5 (Buffer), calcula `bandPx` desde su ancho, llama al adapter
  expand con `top=bandPx`, `bottom=bandPx` y un prompt corto de continuacion de
  escena, devuelve `{ buffer, mimeType }` del 9:16.
- Modo estricto (toggle `safeAreaExtend` + `safeCrop='4:5'` + aspect 9:16):
  - `genAspect = '4:5'` (la base) y se **re-crea** `guidelinesForSafeBase(guidelines)`
    en `lib/campaigns/guidelines.ts` (devuelve `{...guidelines, safeCrop: null}`) para
    no emitir la clausula de safeCrop en un 4:5 donde el frame ya ES la zona segura.
  - tras generar la base, `finalImage = await extendPanelTo916(base)`.
  - el turno previo encadenado se recorta a 4:5 con `centralSafeCrop`.

El modo estricto **deja de concatenar** `SAFE_ZONE_STRONG_CLAUSE` (la zona segura la
garantiza la geometria del 4:5+expand, no el texto). Como esa constante solo se usaba
en estricto, queda sin uso: se **elimina** `SAFE_ZONE_STRONG_CLAUSE` y su test.

### 4. Estimador y UI

- El modo estricto vuelve a ser ~2 pasadas: base (Nano) + expand (FLUX). Se modela
  el costo del expand y se actualiza la copy del editor de guidelines ("~2x").
- Detalle del modelo de costo (multiplicador vs bonus, provider del expand) se fija
  en el plan.

## Manejo de errores / fallback

Si el expand falla por cualquier causa (endpoint no disponible, 402, timeout,
respuesta sin imagen), `extendPanelTo916` **no rompe el panel**: hace fallback al
**9:16 nativo** (genera/usa la salida directa, el comportamiento actual) y registra
el motivo. Asi el usuario siempre obtiene un panel; el estricto solo "mejora" cuando
el expand esta disponible. El probe-first evita descubrir la indisponibilidad en
produccion.

## Testing

- Geometria (`safeAreaBands`, `centralSafeCrop`): tests deterministas con sharp
  (dims y pixeles), como los que existian.
- `buildExpandBody`: test determinista del armado del body (sin red).
- NO se llama a la API real en tests (BFL expand). El smoke real lo corre el usuario
  (incluye el probe-first).
- Verificacion: `pnpm typecheck`, `pnpm build`, vitest de los archivos tocados.

## Fuera de alcance

- Cambiar el modelo de la base 4:5 (sigue Nano, por fidelidad de producto/personaje).
- El "print del canvas que deriva" (fidelidad de la imagen de producto) — issue
  aparte, no del 4:5.
- Outpaint lateral (solo top/bottom; el 4:5 dentro de 9:16 solo recorta altura).

## Constraints

Sin emojis (UI). No `any` (usar `unknown` + narrowing o tipo explicito). pnpm.
Commits sin `Co-Authored-By`. Sin BOM. URLs de proveedor nunca al cliente (el worker
descarga el output del expand y lo sube a Supabase; solo URLs internas). Service role
solo server-side. Adapters siguen las reglas de `.cursor/rules/30-providers.mdc`.
`'use server'` solo exporta funciones async. Migraciones (si hubiera) via MCP antes de
pushear; este diseno NO requiere migracion (reusa el flag `safeAreaExtend`). El probe
y los tests NO llaman APIs reales salvo el script que el usuario corre a proposito.
