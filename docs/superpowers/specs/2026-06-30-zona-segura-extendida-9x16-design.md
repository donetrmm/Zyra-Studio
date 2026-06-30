# Diseno: zona segura 9:16 con extension (panel 4:5 + outpaint)

Fecha: 2026-06-30
Estado: REVERTIDO. El enfoque de extension/guia se abandono (ver revision final).

## Revision final 2026-06-30: enfoque de extension/guia abandonado

Tras varias iteraciones en pruebas reales, NINGUNA variante generativa de
extension dio un resultado confiable: pin (costura), sin pin (deriva + rebana al
sujeto), banda "solo fondo" (rebana), prompt simple (franja negra), e imagen-guia
de zona segura como referencia (el modelo dibuja el verde en el render y solo
genera dentro del 4:5). Causa de fondo: el proveedor no hace outpaint con mascara,
asi que no se puede rellenar solo las bandas dejando el centro intacto y nitido.

Restriccion del caso de uso: el 9:16 se usa directo Y se recorta a 4:5 para algunas
plataformas, asi que ambos deben ser reales y nitidos (descarta bandas con
desenfoque determinista).

Decision: se elimina todo el andamiaje de extension/guia (extendPanelTo916,
pinCenter, composeOnto916, centralSafeCrop, safeAreaBands, safeZoneGuide,
guidelinesForSafeBase, SAFE_AREA_EXTEND_PROMPT, SAFE_ZONE_GUIDE_CLAUSE y el archivo
lib/images/safe-area.ts). El toggle `safeAreaExtend` ahora significa "zona segura
4:5 reforzada": el panel se genera NATIVO en 9:16 y se concatena al prompt la
clausula fuerte `SAFE_ZONE_STRONG_CLAUSE` (producto + mayor parte del personaje
dentro del 4:5 central, margenes vacios). Es mejor-esfuerzo por prompt, sin
garantia geometrica, pero sin artefactos (verde/negro/costura/rebanado) y a 1x.

Si se necesita garantia dura: integrar un modelo de outpaint con mascara real
(FLUX Fill/Expand u otro), como proyecto aparte.

## Revision 2026-06-30: se elimino el pin del centro

El diseno original fijaba el centro con `pinCenter` (re-pegar la base 4:5 exacta
sobre el 9:16 extendido) para garantizar cero drift. En pruebas reales eso
producia una **costura horizontal dura** y un fondo distinto arriba/abajo: Gemini
genera centro + bandas como UNA imagen coherente, y al swapear la base por encima,
las bandas (coherentes con el centro de Gemini) dejaban de empatar. Como el
proveedor (Gemini 3 Pro Image) **no tiene inpaint con mascara**, no hay forma de
fijar el centro pixel-exacto sin romper la continuidad.

Decision revisada: **no se re-pega la base**. Se usa la salida extendida de Gemini
tal cual (se mantiene el compuesto de bandas negras para indicar donde extender) y
el prompt de extension exige mantener el centro identico y nitido. La continuidad
queda nitida y coherente; el centro se preserva por prompt (sesgo fuerte), no por
garantia geometrica pixel-exacta. `pinCenter` se elimino del codigo.

## Problema

El guideline `safeCrop='4:5'` inyecta una clausula de texto que pide mantener
el contenido clave dentro del 4:5 central de un frame 9:16. El modelo **no lo
respeta de forma fiable**: con un producto alto (canvas de 150 cm) lo hace
grande llenando el 9:16 y lo recorta en los bordes, justo donde se quiere
completo (el hook). Reforzar el prompt (clausula reconciliada, ya implementada)
ayuda pero no garantiza: la zona segura es un problema de **geometria**, no de
texto, y el modelo obedece el texto solo en parte.

Una imagen-plantilla de zona segura como **referencia** tampoco sirve: en Nano
y Seedance una `reference_image` es contenido que el modelo reproduce, no una
mascara de composicion; pasarla mete el recuadro/lineas/texto en el render.

## Decision

Para `aspect_ratio = 9:16` con la zona segura activa, ofrecer una **opcion
opt-in** (con aviso de consumo) que genera el panel en **dos pasos**:

1. **Base 4:5 (Nano):** el contenido clave (producto y caras) se genera en un
   frame 4:5 nativo. Al ser el frame 4:5, el contenido **fisicamente no cabe
   fuera** de la zona segura: garantia estructural, no por texto.
2. **Extension a 9:16 (Nano):** la base 4:5 se compone centrada en un lienzo
   9:16 con bandas vacias arriba y abajo, y Nano **rellena solo esas bandas**
   continuando el fondo, sin sujetos. El centro queda intacto.

Resultado: un **9:16 entregable** (se ve completo) cuyo **recorte 4:5 no pierde
contenido clave**. Sirven los dos formatos.

### Por que ambas etapas con Nano (correccion al FLUX/Nano)

El panel se genera con Nano porque **FLUX no mantiene fieles producto ni
personaje** (decision documentada en `server-actions/storyboard.ts`). En el
modelo de dos pasos:

- **Base 4:5** contiene producto + caras -> **debe ser Nano** (fidelidad). Una
  base FLUX perderia el parecido del cuadro y del personaje.
- **Extension (solo fondo, sin sujetos)** es el lugar barato, pero el outpaint
  de FLUX (FLUX Fill) **no esta cableado** hoy (adapter nuevo), y extender con
  Nano conversacional reusa la plomeria existente y empata iluminacion/color.

v1 = ambas etapas con Nano. **FLUX Fill para los margenes queda como
optimizacion futura de costo**, fuera de alcance.

## Dos modos coexistentes

`safeCrop='4:5'` se mantiene como esta. La extension es un flag **adicional**:

- **Modo ligero** (`safeCrop` on, extend off): comportamiento actual. La
  clausula reconciliada de texto sesga el encuadre en una sola generacion 9:16.
  Sin costo extra. Para quien no quiere pagar el doble.
- **Modo estricto** (`safeCrop` on, extend on, aspecto 9:16): el flujo de dos
  pasos descrito aqui. Garantia estructural. ~2x creditos por panel.

## Modelo de datos - sin migracion

`creative_guidelines` es jsonb (mig. 049). Se extiende `CreativeGuidelinesSchema`
(`lib/campaigns/guidelines.ts`) con un flag opcional:

- `safeAreaExtend: z.boolean().optional()` - activa el modo estricto.

Ausente o `false` = comportamiento actual identico (cero regresion). El flag
solo tiene efecto cuando ademas `safeCrop === '4:5'` y el aspecto del item es
`9:16`; en cualquier otro caso se ignora (el flujo cae al modo ligero/actual).

## Geometria (modulo nuevo `lib/images/safe-area.ts`, sharp, determinista)

Frame 9:16 y zona segura 4:5 centrada. Para una base de ancho `W`:

- Base 4:5: dimensiones `(W, 1.25*W)` (altura = ancho * 5/4).
- Lienzo 9:16: `(W, 1.7778*W)` (altura = ancho * 16/9).
- Banda total = `1.7778*W - 1.25*W = 0.5278*W`; cada banda (arriba/abajo) =
  `0.2639*W`.
- La zona segura ocupa `1.25/1.7778 = 70.31%` del alto, centrada; cada banda
  `14.84%`. (Coincide con la referencia ZonasSeguras/9.16 a 4.5.png.)

Helpers puros (sharp local, sin red - testeables con buffers sinteticos):

- `safeAreaBands(width: number): { bandPx: number; canvasHeight: number }` -
  calcula banda y alto de lienzo 9:16 a partir del ancho de la base 4:5.
- `composeOnto916(base4x5: Buffer, fill: 'black'): Promise<Buffer>` - compone la
  base centrada en un lienzo 9:16 con bandas solidas (relleno temporal para el
  paso de extension).
- `centralSafeCrop(panel916: Buffer): Promise<Buffer>` - recorta el 4:5 central
  de un 9:16 guardado (recupera la base, determinista). Lo usa la cadena/refino.
- `pinCenter(extended916: Buffer, base4x5: Buffer): Promise<Buffer>` - pega la
  base 4:5 original sobre el centro del 9:16 extendido, garantizando **cero
  drift** en el centro: el resultado final es `[banda Nano][base original][banda
  Nano]`. Solo las bandas vienen del modelo.

## Flujo de generacion (modo estricto)

En `server-actions/storyboard.ts`, las rutas de panel (`generatePanelAction`
fresco y encadenado, y `refinePanelAction`) ganan una rama cuando el modo
estricto aplica:

1. **Base 4:5 (Nano):** misma prompt del panel (producto/personaje/escena), pero
   con `aspectRatio: '4:5'` y **sin la clausula de safeCrop** (el frame ya ES la
   zona segura; meter "mantener dentro del 4:5 central" en un frame 4:5 confunde).
   Se mantienen `showFullProduct`/`hookProductHero` (ahora si funcionan: el
   producto completo cabe). Helper puro `guidelinesForSafeBase(guidelines)`
   devuelve los guidelines con `safeCrop` y `safeAreaExtend` neutralizados.
   - Encadenado/refino: antes de generar, el panel previo guardado (9:16) se pasa
     por `centralSafeCrop` para recuperar su base 4:5 y mantener la cadena
     conversacional en 4:5.
2. **Compose:** `composeOnto916(base4x5, 'black')` -> lienzo 9:16 con bandas.
3. **Extension (Nano):** edicion de ese lienzo con la instruccion (ASCII):
   `Fill only the empty top and bottom bands of this image by continuing the
   existing scene and background naturally into them; keep the central area
   exactly unchanged; do not place the product, any person, any text or any new
   object in the top or bottom bands - they are background extension only.`
4. **Pin center:** `pinCenter(extensionOutput, base4x5)` -> 9:16 final con el
   centro byte-identico a la base. Este buffer es el que se sube y se promueve a
   `storyboard_image_id`.

Modo ligero / aspecto != 9:16 / flag off: el flujo actual de una sola generacion,
sin cambios.

## Creditos (una fila, 2x, flujo atomico)

El panel sigue siendo **una sola generacion** (`generations`), con las dos
llamadas Nano (base + extension) como detalle interno de su procesamiento. La
base 4:5 vive en memoria (Buffer); solo se sube el 9:16 final (tras pin). No hay
fila intermedia ni asset extra en la libreria.

El costo estimado de esa fila en modo estricto es **2x** el de una imagen Nano
(dos pasadas). El estimador (`lib/credits/estimator.ts`) lo refleja via un param
(p.ej. `params: { passes: 2 }` o `safeAreaExtend: true`). El ciclo es el atomico
normal: **un** `reserve_credits` por el monto 2x, `confirm_credits` al exito,
`refund_credits` si **cualquiera** de las dos pasadas falla (se refunda el total,
no se cobra un panel inservible). El aviso de UI declara el ~2x.

## UI

En el editor de guias creativas (`CreativeGuidelinesEditor`), un switch nuevo
**"Zona segura estricta (9:16 + recorte 4:5 garantizado)"** que:

- Aparece **solo** cuando `safeCrop='4:5'` esta activo y el aspecto de la campana
  es 9:16 (si no, oculto/deshabilitado).
- Muestra el aviso: **"Genera cada panel dos veces (base 4:5 + extension a 9:16):
  ~2x creditos por panel."**

`setCreativeGuidelinesAction` (`server-actions/campaigns.ts`) ya escribe el jsonb
de guidelines; solo se extiende el schema para aceptar `safeAreaExtend`.

## Alcance

- **Paneles:** todos (fresco, encadenado, refinado) en modo estricto.
- **Video:** solo panel en v1. El video R2V hereda la zona segura por el frame de
  apertura (ahora 9:16 con centro seguro, que el compiler cita como "exact
  opening frame and overall composition") + la clausula de texto del compiler de
  Seedance. Validar en smoke; forzar el video queda fuera de v1.
- **Aspecto:** solo 9:16 -> 4:5. Otros aspectos: opcion oculta, sin cambios.

## Fuera de alcance

- FLUX Fill para la extension de margenes (optimizacion de costo futura; necesita
  adapter nuevo).
- Forzar/post-procesar el video directamente.
- Otros mapeos de aspecto (1:1, 16:9 -> X). Solo 9:16/4:5 en v1.
- Recorte 4:5 automatico del entregable final (el usuario recorta en post).

## Tests

- `lib/images/safe-area.ts` (sharp, buffers sinteticos, deterministas):
  - `safeAreaBands`: banda = round(0.2639*W), alto lienzo = round(1.7778*W).
  - `composeOnto916`: el lienzo mide 9:16; el centro contiene la base; las bandas
    son solidas (color de relleno).
  - `centralSafeCrop`: recorta el 4:5 central; redondea consistente con compose
    (compose -> centralSafeCrop recupera dimensiones de la base).
  - `pinCenter`: el centro del resultado es pixel-identico a la base; las bandas
    provienen del input extendido.
- `guidelinesForSafeBase`: neutraliza `safeCrop` y `safeAreaExtend`, conserva
  `showFullProduct`/`hookProductHero`.
- `CreativeGuidelinesSchema`: acepta `safeAreaExtend` bool y tolera ausencia.
- La instruccion de extension (string puro) incluye "keep the central area
  exactly unchanged" y "do not place the product, any person ... in the top or
  bottom bands"; es ASCII.
- Sin tests con API real: la orquestacion de dos pasos (IO Nano) la valida el
  usuario en smoke.

## Riesgos / notas

- El paso de extension podria, pese a la instruccion, alterar el centro; `pinCenter`
  lo neutraliza por composicion determinista (el centro final siempre es la base).
- El video aun depende de que Seedance respete el frame de apertura; si filtra
  contenido a las bandas en movimiento, el siguiente nivel es intervenir el video
  (fuera de v1).
- Nano debe soportar `aspectRatio: '4:5'` (ratio estandar de Gemini). Verificar en
  el plan antes de codificar el paso 1; si no, generar a un ratio cercano y
  recortar a 4:5 con sharp.
- Costo: ~2x por panel solo con la opcion activa; apagada, byte-identico al actual.
