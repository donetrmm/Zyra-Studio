# Google Nano Banana Pro — API Documentation

> **Transporte:** el repo llama a Nano Banana vía Vercel AI Gateway
> (`AI_GATEWAY_API_KEY`, model string `google/gemini-3-pro-image` vía
> AI SDK `generateText`), no vía la API nativa que documenta este archivo. Los
> detalles de request/response nativos (endpoint REST, `x-goog-api-key`,
> shape de `generationConfig`) siguen aplicando solo a Veo, que no migró. Ver
> `docs/superpowers/specs/2026-07-08-migracion-ai-gateway-design.md`. El slug
> interno `gemini-3-pro-image-preview` se traduce a este wire slug vía el
> MODEL_MAP de `lib/providers/gateway.ts`.

**Caso de uso:** Generación y edición de imágenes con consistencia de personajes (hasta 14 referencias), texto en imagen de alta fidelidad, infografías inteligentes con datos en tiempo real, razonamiento espacial complejo.

## Acceso

- **Plataforma:** Gemini API (Google AI Studio) o Vertex AI
- **Documentación oficial:** https://ai.google.dev/gemini-api/docs/image-generation
- **API Key:** https://aistudio.google.com/apikey

## Modelos disponibles (familia Nano Banana)

| Modelo | ID | Uso |
|---|---|---|
| **Nano Banana Pro** | `gemini-3-pro-image-preview` | Producción profesional, max fidelidad, hasta 5 chars + 6 objetos |
| Nano Banana 2 | `gemini-3.1-flash-image-preview` | Default balanceado, hasta 4 chars + 10 objetos, soporta 512px |
| Nano Banana | `gemini-2.5-flash-image` | Alta velocidad, hasta 3 refs |

## Endpoint REST

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent
```

Header: `x-goog-api-key: $GEMINI_API_KEY`

## Capacidades clave

- **Resoluciones:** 512 (solo 3.1 Flash), 1K, 2K, 4K
- **Aspect ratios:** `1:1`, `1:4`, `1:8`, `2:3`, `3:2`, `3:4`, `4:1`, `4:3`, `4:5`, `5:4`, `8:1`, `9:16`, `16:9`, `21:9`
- **Hasta 14 imágenes de referencia** mezclando personajes + objetos
- **Texto de alta fidelidad** dentro de la imagen (logos, infografías, posters)
- **Thinking mode:** razona internamente con "thought images" antes del output final
- **Grounding con Google Search:** datos en tiempo real (clima, eventos, stocks)
- **Image Search grounding** (solo 3.1 Flash): usa imágenes web como contexto visual
- **Edición conversacional** multi-turn
- **Watermark SynthID** en todos los outputs

## Parámetros (config)

| Parámetro | Valores |
|---|---|
| `responseModalities` | `["TEXT", "IMAGE"]` o `["IMAGE"]` |
| `imageConfig.aspectRatio` | ver lista arriba |
| `imageConfig.imageSize` | `"512"`, `"1K"`, `"2K"`, `"4K"` (uppercase K) |
| `thinkingConfig.thinkingLevel` | `"minimal"` (default) \| `"high"` (solo 3.1 Flash) |
| `thinkingConfig.includeThoughts` | `true` \| `false` |
| `tools` | `[{google_search: {}}]` para grounding |

## Ejemplo Python (text-to-image)

```python
from google import genai
from google.genai import types

client = genai.Client()

response = client.models.generate_content(
    model="gemini-3-pro-image-preview",
    contents=["A magazine cover with bold serif text 'Nano Banana Pro'..."],
    config=types.GenerateContentConfig(
        response_modalities=['IMAGE'],
        image_config=types.ImageConfig(
            aspect_ratio="16:9",
            image_size="2K"
        )
    )
)

for part in response.parts:
    if image := part.as_image():
        image.save("output.png")
```

## Ejemplo Python (edición con múltiples referencias)

```python
from PIL import Image

response = client.models.generate_content(
    model="gemini-3-pro-image-preview",
    contents=[
        "An office group photo of these people making funny faces.",
        Image.open('person1.png'),
        Image.open('person2.png'),
        Image.open('person3.png'),
    ],
    config=types.GenerateContentConfig(
        response_modalities=['IMAGE'],
        image_config=types.ImageConfig(aspect_ratio="5:4", image_size="2K")
    )
)
```

## Ejemplo Python (edición conversacional)

```python
chat = client.chats.create(
    model="gemini-3-pro-image-preview",
    config=types.GenerateContentConfig(
        response_modalities=['TEXT', 'IMAGE'],
        tools=[{"google_search": {}}]
    )
)

# Turno 1: generar
r1 = chat.send_message("Create a photosynthesis infographic in cookbook style.")

# Turno 2: editar manteniendo composición
r2 = chat.send_message("Update this infographic to be in Spanish. Don't change other elements.")
```

## Ejemplo cURL

```bash
curl -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "A nano banana dish in a fancy restaurant"}]}],
    "generationConfig": {
      "responseModalities": ["IMAGE"],
      "responseFormat": {"image": {"aspectRatio": "16:9", "imageSize": "2K"}}
    }
  }'
```

## Grounding con Google Search

```python
response = client.models.generate_content(
    model="gemini-3-pro-image-preview",
    contents="Visualize the current 5-day weather forecast for San Francisco as a modern chart.",
    config=types.GenerateContentConfig(
        response_modalities=['IMAGE'],
        tools=[{"google_search": {}}]
    )
)
```

## Capacidad de referencias por modelo

| Modelo | Objetos (alta fidelidad) | Personajes (consistencia) |
|---|---|---|
| Nano Banana Pro | hasta 6 | hasta 5 |
| Nano Banana 2 | hasta 10 | hasta 4 |

## Buenas prácticas de prompt

- **Describe la escena, no listes keywords.** Narrativa descriptiva > lista de adjetivos.
- **Texto en imagen:** colócalo al inicio del prompt, entre comillas.
- **Fotorrealismo:** usa términos de fotografía (lente, ángulo, iluminación).
- **Mockups:** especifica "studio-lit", three-point softbox, ángulos de cámara.
- **Iteración:** usa chat multi-turn para refinar.
- **Negative semántico:** "an empty street with no traffic" > "no cars".

## Idiomas soportados (óptimo)

EN, ar-EG, de-DE, **es-MX**, fr-FR, hi-IN, id-ID, it-IT, ja-JP, ko-KR, pt-BR, ru-RU, ua-UA, vi-VN, zh-CN.

## Limitaciones

- No soporta audio/video como input
- No genera fondos transparentes
- Image Search grounding no soporta búsqueda de personas reales
- Watermark SynthID inevitable

## Batch API

Para alto volumen, usar Batch API (turnaround hasta 24h, rate limits mayores).

## Precios (referencia)

- Nano Banana Pro: $0.08 (1K) / $0.12 (2K) / $0.16 (4K)
- Nano Banana 2: más económico

Ver: https://ai.google.dev/gemini-api/docs/pricing
