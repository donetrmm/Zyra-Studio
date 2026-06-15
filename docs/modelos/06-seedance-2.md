# Seedance 2.0 (ByteDance) — vía BytePlus ModelArk

> Modelo de video principal de V2 (doc `ZyraStudioV2/ARQUITECTURA-Y-CAPACIDADES-V2.md` §7.2).
> Multimodal nativo: texto + imagen + video + audio como entradas de una sola generación,
> con audio estéreo sincronizado en la salida. Paper: arXiv:2604.14148.

## Backend seleccionable (ModelArk default / fal para pruebas)

El adapter `lib/providers/seedance.ts` tiene dos backends con la misma interfaz:

- **ModelArk** (default): lo que se describe en este doc. Requiere `ARK_API_KEY`.
- **AtlasCloud**: se activa con `SEEDANCE_PROVIDER=atlas` (usa `ATLASCLOUD_API_KEY`).
  Per-second, más barato (~3x vs fal) y sin waitlist/restricción regional.
  `POST https://api.atlascloud.ai/api/v1/model/generateVideo` → `{ data: { id } }`;
  `GET .../prediction/{id}` → `{ data: { status, outputs:[url], error } }`. **Confirmado en
  smoke (2026-06-15):** T2V con `bytedance/seedance-2.0/text-to-video` genera OK (endpoint,
  auth y poll correctos). El `model` es nuestro slug **por operación** — pero **sin el tier
  `fast`**: Atlas no expone fast (es un id de ModelArk), y el slug `/fast/...` devuelve
  `400 {"msg":"not found"}`. El adapter mapea `/fast/` → estándar (`atlasModelId`). Body
  análogo a ModelArk (`resolution`/`ratio`/`duration`/`generate_audio`/`watermark`); I2V usa
  `image_url`. ⚠️ El shape multi-referencia de R2V (`image_urls`/`video_urls`/`audio_urls`)
  sigue **inferido** — pendiente de confirmar con un smoke de I2V/R2V.

Los 6 slugs internos (`bytedance/seedance-2.0/...`) son la clave lógica en ambos casos.

## Endpoint y modelos (ModelArk, Ark v3 REST)

Base URL (BytePlus global): `https://ark.ap-southeast.bytepluses.com/api/v3`
(Volcengine China: `https://ark.cn-beijing.volces.com/api/v3` con ids `doubao-seedance-2-0-*`).
Auth: header `Authorization: Bearer ARK_API_KEY`. Configurable con `ARK_API_BASE_URL`.

- `POST /contents/generations/tasks` → `{ "id": "cgt-..." }`
- `GET  /contents/generations/tasks/{id}` → status + output (ver abajo)

A diferencia de fal hay **un solo `model` y un solo endpoint**: la operación y los
archivos se expresan con los `role` del array `content`, no con la URL. El tier va en el
model id:

| Model id (ModelArk) | Tier | Slug interno (DB/model_pricing/router) |
|---|---|---|
| `dreamina-seedance-2-0-260128` | standard | `bytedance/seedance-2.0/{text,image,reference}-to-video` |
| `dreamina-seedance-2-0-fast-260128` | fast (draft) | `bytedance/seedance-2.0/fast/{...}-to-video` |

Los 6 slugs internos siguen siendo la clave lógica (codifican tier+operación); el adapter
`lib/providers/seedance.ts` los traduce al model id + roles. Sin cancel síncrono útil: el
refund es local (mismo caso Veo/Kling).

## Cuerpo del request (`content` + params)

`content` es un array; el primer item es el texto y los media van con `role`. El **orden de
los media items define la numeración del sistema @** (@Image1 = 1er `reference_image`, etc.).

| Item / param | Forma | Notas |
|---|---|---|
| texto | `{ type:"text", text }` | En R2V referencia archivos como `@Image1`, `@Video1`, `@Audio1` |
| imagen | `{ type:"image_url", image_url:{url}, role }` | I2V: `first_frame` / `last_frame`. R2V: `reference_image` (hasta 9, <30 MB c/u) |
| video | `{ type:"video_url", video_url:{url}, role:"reference_video" }` | R2V, hasta 3, 2–15 s combinados, <50 MB c/u, 480p–720p |
| audio | `{ type:"audio_url", audio_url:{url}, role:"reference_audio" }` | R2V, hasta 3, ≤15 s combinados, <15 MB c/u |
| `resolution` | enum | `480p` `720p` `1080p` — **fast no soporta 1080p** (default `720p`) |
| `duration` | int | 4–15; si se omite ModelArk usa su default (5) |
| `ratio` | enum | `21:9` `16:9` `4:3` `1:1` `3:4` `9:16` `adaptive` — el adapter mapea nuestro `auto` → `adaptive` |
| `generate_audio` | bool | default `true`; el audio NO cuesta extra |
| `watermark` | bool | el adapter lo fija en `false` |
| `seed` | int | fijarlo mantiene la composición entre tiers (draft → final) |

**Tope global: 12 archivos de referencia** entre todos los tipos. El adapter valida 9/3/3 y
el total antes de llamar a ModelArk.

## Output

```json
{ "id": "cgt-...", "status": "succeeded", "content": { "video_url": "..." }, "seed": 42, "usage": { "total_tokens": 103000 } }
```

Status: `queued` → `running` → `succeeded` | `failed` | `expired` | `cancelled`. El worker
descarga `content.video_url` apenas el status es `succeeded` (la URL expira a 24h; regla
inmutable: nunca llega al cliente). El `seed` real vuelve en metadata de la generación.

## Pricing

ModelArk cobra **por tokens** (no por segundo): un clip 5 s 1080p ≈ 103k tokens ≈ $0.93;
T2V/I2V 1080p ≈ 46 CNY/1M tok (~$6.40), tasks con video de referencia ≈ 28 CNY/1M tok
(~$3.90). `usage.total_tokens` vuelve en el GET de la task.

**Nuestros créditos siguen estimándose por segundo** (`model_pricing` 024: 45/80/100/220
cr/s según tier) porque reservamos el crédito antes de generar y el token count solo se
conoce al final. La migración 024 está aplicada (inmutable) y sus slugs siguen siendo la
clave válida; su comentario de margen referencia la base de costo de fal y quedó **obsoleto
en cifras** — re-validar los márgenes con `usage.total_tokens` reales del smoke test antes
de la demo (ajustable desde `/admin/pricing` sin nueva migración).

## El sistema de referencias @ (R2V)

Cada archivo se cita en el prompt por tipo y orden de subida: `@Image1`, `@Video1`, `@Audio1`.
**El orden de los arrays `image_urls`/`video_urls`/`audio_urls` debe coincidir con la
numeración del prompt** — el handler pasa los paths en el mismo orden en que el Prompt
Director los cita.

Tres reglas (guías Morphic/RunDiffusion):
1. Declarar el propósito exacto: "como fotograma inicial", "para el movimiento de cámara".
2. Acotar qué parte usar: "solo el rostro y peinado de @Image1, no la ropa ni el fondo".
3. Nunca dejar una referencia sin propósito ("usa @Image1" a secas es el error más común).

Qué extrae el modelo de cada tipo:
- **Imágenes** → composición, rasgos de personajes, detalles de producto, iluminación, estilo.
- **Videos** → trayectorias de cámara, velocidad, timing de acciones, transiciones, efectos.
- **Audio** → ritmo y beats, mood, dinámica de volumen, timbre de voz.

## Estructura de prompt (CRAFT, resumen)

1. **C**ontext — dónde/cuándo/atmósfera.
2. **R**eference — cada @ con propósito y exclusiones.
3. **A**ction — verbos: movimientos, gestos, interacciones, eventos físicos.
4. **F**raming — terminología real: dolly in, tracking, rack focus, POV, contrapicado.
5. **T**iming — marcadores por segundos ("0-3s: wide shot… 7-11s: sirve el plato").

Reglas operativas: una acción y un movimiento de cámara por toma; complejidad ∝ duración
(1 idea ≈ 4 s); re-describir escenario/personaje en cada toma (el modelo no recuerda);
2–4 frases por toma, 4–8 si es multi-toma.

## Técnicas avanzadas

- **Extensión**: "Extiende @Video1 por X s" + acción de continuación. ⚠️ La duración de
  generación = X (la extensión), NO el total final. Encadenando se superan los 15 s.
- **Escena puente**: segmento generado que conecta el final de @Video1 con el inicio de
  @Video2, describiendo la acción puente y pidiendo coincidencia de luz y paso.
- **Reemplazo de personaje**: "En @Video1, reemplaza a [sujeto] por la persona de @Image1.
  Acciones cuadro a cuadro idénticas; escenario, luz y cámara sin cambios."
- **Plantilla replicable** (base de las plantillas vivas de V2): "Referencia el estilo y la
  estructura de @Video1 (cámara, transiciones, ritmo, color grading), pero reemplaza el
  producto por el de @Image1."
- **Consistencia de personaje**: misma hoja maestra en TODAS las generaciones + "apariencia
  exacta de @ImageN"; variaciones de ropa/expresión solo en texto.

## Longitud del prompt

ModelArk no documenta un límite de caracteres del campo de texto. El techo de 4000
caracteres es NUESTRO (`SubmitSeedanceSchema`), conservador y alineado con la guía de
longitud útil (2-4 frases por toma, 4-8 multi-toma); el compiler avisa con warning si lo
supera.

## Límites y qué falla (validar antes de encolar)

| Falla | Causa | Mitigación |
|---|---|---|
| Identidad inestable | Reconstruye cada frame; no recuerda | Hoja maestra como referencia siempre |
| Manos y dedos | Detalle perdido en el espacio latente | Sin manos en primer plano extremo; darlas como referencia |
| Texto en pantalla | Símbolos discretos vs píxeles | Texto/logo/legal en post o en imagen estática |
| Física rara | Imita, no calcula | Acción simple + video de referencia |
| 3+ sujetos | La atención se reparte | Generar por separado y montar |
| Rostros reales | **Bloqueado anti-deepfake** | Personajes generados (Cast con FLUX) o Kling/Veo |
| Cámara errática | Instrucciones contradictorias | Una sola orden de cámara explícita |

## Operación

- **Draft barato**: fast 480p para explorar; **final**: standard 720p; 1080p solo hero pieces.
  El costo crece ~cuadrático con duración × resolución (tokens de atención).
- **Seed fijo** para iterar manteniendo composición entre draft y final.
- Latencia esperada: minutos para clips largos con referencias. Handler: `MAX_POLLS=40`,
  delays 15→30 s (ajustar tras smoke test si queda corto/largo).
- Videos de referencia: recortar a 3-5 s centrados en UNA técnica; calidad máxima
  (los artefactos de compresión confunden al modelo).
