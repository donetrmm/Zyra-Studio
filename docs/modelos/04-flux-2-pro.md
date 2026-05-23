# Black Forest Labs FLUX 2 Pro — API Documentation

**Caso de uso:** Fotorrealismo crítico, hero shots, fotografía de producto, retratos hiperrealistas, branding premium, edición con hasta 8 imágenes de referencia.

## Acceso

- **Documentación oficial:** https://docs.bfl.ml/
- **Base URL global:** `https://api.bfl.ai`
- **Regional EU:** `https://api.eu.bfl.ai` (GDPR)
- **Regional US:** `https://api.us.bfl.ai`
- **Auth:** Header `x-key: $BFL_API_KEY`
- **Endpoint principal:** `POST /v1/flux-2-pro-preview`

> También accesible vía fal.ai, Replicate, Together AI, OpenRouter con su propio billing.

## Capacidades clave

- **32B parámetros** (Mistral-3 24B VLM + rectified flow transformer)
- **Resolución:** hasta 4 MP (~2048×2048)
- **Hasta 8 imágenes de referencia** vía API para consistencia de personajes/productos
- **Texto en imagen** preciso
- **Edición** (image-to-image) y generación (text-to-image)
- **Color matching** y consistencia de identidad

## Parámetros principales

| Parámetro | Tipo | Descripción |
|---|---|---|
| `prompt` | string | Descripción (hasta 32K tokens) |
| `width` | int | Ancho en píxeles |
| `height` | int | Alto en píxeles |
| `image_prompt` | string/array | Imagen(es) de referencia base64 o URL |
| `prompt_upsampling` | bool | Mejora automática del prompt |
| `seed` | int | Reproducibilidad |
| `safety_tolerance` | int | 0–6 |

## Ejemplo Python (text-to-image)

```python
import requests
import time
import os

response = requests.post(
    'https://api.bfl.ai/v1/flux-2-pro-preview',
    headers={
        'accept': 'application/json',
        'x-key': os.environ.get("BFL_API_KEY"),
        'Content-Type': 'application/json',
    },
    json={
        'prompt': 'A serene landscape with mountains at golden hour',
        'width': 1440,
        'height': 810
    }
)

data = response.json()
polling_url = data['polling_url']  # CRÍTICO: usar polling_url devuelto

# Polling
while True:
    time.sleep(0.5)
    result = requests.get(
        polling_url,
        headers={'x-key': os.environ.get("BFL_API_KEY")}
    ).json()

    if result['status'] == 'Ready':
        image_url = result['result']['sample']
        # ⚠️ Descarga inmediata: URLs expiran en 10 min
        break
    elif result['status'] in ['Error', 'Failed']:
        break
```

## Ejemplo cURL

```bash
curl -X POST 'https://api.bfl.ai/v1/flux-2-pro-preview' \
  -H 'accept: application/json' \
  -H "x-key: ${BFL_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "A cat in a market holding a silver fish",
    "width": 1024,
    "height": 1024
  }'
```

## Ejemplo en Together AI (alternativa simplificada)

```bash
curl -X POST "https://api.together.xyz/v1/images/generations" \
  -H "Authorization: Bearer $TOGETHER_API_KEY" \
  -d '{
    "model": "black-forest-labs/FLUX.2-pro",
    "prompt": "Anime style version of this image",
    "width": 1024,
    "height": 768,
    "steps": 28,
    "n": 1,
    "image_url": "https://example.com/reference.png"
  }'
```

## Flujo crítico de la API

1. POST al endpoint → devuelve `id` y `polling_url`
2. **Siempre usar `polling_url` devuelto** (no hardcodear)
3. Polling GET cada 0.5s hasta `status: "Ready"`
4. **Descargar imagen inmediatamente** (URLs expiran en **10 minutos**, no CORS)
5. Re-servir desde tu propia infraestructura

## Manejo de imágenes (importante)

```python
# Patrón download & re-serve
import requests
from datetime import datetime

def handle_result(result):
    if result['status'] == 'Ready':
        sample_url = result['result']['sample']
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        local_path = f"./images/img_{timestamp}.jpg"
        
        # Descargar antes de que expire
        img_data = requests.get(sample_url).content
        with open(local_path, 'wb') as f:
            f.write(img_data)
        
        return local_path
```

## Rate limits

- **24 requests concurrentes** (la mayoría de endpoints)
- 6 concurrentes en `flux-kontext-max`
- Implementar exponential backoff en 429
- 402 = créditos insuficientes

## Best practices de prompt

- Prompts claros y específicos sin sobrecargar de adjetivos
- **Texto en imagen:** instrucción al inicio + texto exacto entre comillas + posición
- Múltiples refs: ordenar por prioridad
- Para fotorrealismo: lente, iluminación, ángulo de cámara

## Precios

- **Input (refs):** $0.015 por megapixel
- **Output:** primer MP $0.03, MPs subsecuentes $0.015
- Imagen 1MP típica: **~$0.03**

Ver: https://bfl.ai/pricing?category=flux.2

## Endpoints adicionales

| Endpoint | Función |
|---|---|
| `/v1/flux-2-pro-preview` | Generación + edición principal |
| `/v1/get_result` | Obtener resultado |
| `/v1/my_finetunes` | Listar finetunes propios |
| Finetune endpoints | Entrenamiento custom |
