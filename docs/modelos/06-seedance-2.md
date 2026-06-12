# Seedance 2.0 (ByteDance) — vía fal.ai

> Modelo de video principal de V2 (doc `ZyraStudioV2/ARQUITECTURA-Y-CAPACIDADES-V2.md` §7.2).
> Multimodal nativo: texto + imagen + video + audio como entradas de una sola generación,
> con audio estéreo sincronizado en la salida. Paper: arXiv:2604.14148.

## Slugs en fal.ai

| Slug | Operación | Tier |
|---|---|---|
| `bytedance/seedance-2.0/text-to-video` | T2V | standard |
| `bytedance/seedance-2.0/image-to-video` | I2V (frame inicial + final opcional) | standard |
| `bytedance/seedance-2.0/reference-to-video` | R2V (sistema @) | standard |
| `bytedance/seedance-2.0/fast/text-to-video` | T2V | fast (draft) |
| `bytedance/seedance-2.0/fast/image-to-video` | I2V | fast |
| `bytedance/seedance-2.0/fast/reference-to-video` | R2V | fast |

Auth y cola: igual que Kling (mismo `@fal-ai/client`, `FAL_KEY`, submit → status → result).
Sin cancel remoto: el refund es local (mismo caso Veo/Kling).

## Parámetros de entrada

| Param | Tipo | Default | Notas |
|---|---|---|---|
| `prompt` | string | — | En R2V referencia archivos como `@Image1`, `@Video1`, `@Audio1` |
| `image_url` / `end_image_url` | string | — | Solo I2V. **Verificar nombres exactos en el smoke test** (confirmados para R2V; I2V inferido del patrón fal) |
| `image_urls` | string[] | — | R2V, hasta 9, <30 MB c/u |
| `video_urls` | string[] | — | R2V, hasta 3, 2–15 s combinados, <50 MB c/u, 480p–720p |
| `audio_urls` | string[] | — | R2V, hasta 3, ≤15 s combinados, <15 MB c/u |
| `resolution` | enum | `720p` | `480p` `720p` `1080p` — **fast no soporta 1080p** |
| `duration` | enum | `auto` | `auto` o entero 4–15 (se manda como string) |
| `aspect_ratio` | enum | `auto` | `auto` `21:9` `16:9` `4:3` `1:1` `3:4` `9:16` |
| `generate_audio` | bool | `true` | El audio NO cuesta extra |
| `seed` | int | — | Fijarlo mantiene la composición entre tiers (draft → final) |

**Tope global: 12 archivos de referencia** entre todos los tipos. El adapter valida 9/3/3 y
el total antes de llamar a fal.

## Output

```json
{ "video": { "url": "...", "content_type": "video/mp4" }, "seed": 42 }
```

El worker descarga `video.url` y lo sube a Storage (regla inmutable: URLs de fal nunca
llegan al cliente). El `seed` real vuelve en metadata de la generación.

## Pricing (fal.ai, junio 2026 — por segundo, audio incluido)

| Tier · resolución | USD/s | Clip 10 s |
|---|---|---|
| Standard 720p | $0.3034 | ≈ $3.03 |
| Standard 1080p | $0.682 | ≈ $6.82 |
| Fast 720p | $0.2419 | ≈ $2.42 |
| Fast 480p | ~$0.114 (medido en smoke test, 2026-06-10: $0.91 por 2 clips de 4 s) | ≈ $1.14 |

Créditos en `model_pricing` (024): 45/80/100/220 cr/s según tier — ver comentario de la
migración para el cálculo del margen.

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

fal **no documenta** un límite de caracteres del campo `prompt` (verificado contra su
API reference, 2026-06-12). El techo de 4000 caracteres es NUESTRO
(`SubmitSeedanceSchema`), conservador y alineado con la guía de longitud útil
(2-4 frases por toma, 4-8 multi-toma); el compiler avisa con warning si lo supera.

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
