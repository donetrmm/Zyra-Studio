# Kuaishou Kling 3.0 — API Documentation

**Caso de uso:** Generación de video económica, alto volumen, escenas multi-shot con personajes consistentes, lip-sync para avatares.

## Acceso

- **Documentación oficial:** https://klingapi.com/docs
- **Base URL:** `https://api.klingapi.com`
- **Auth:** Bearer token (`Authorization: Bearer <API_KEY>`)
- **Free tier:** $1 en créditos al registrarse

> Nota: Kuaishou también ofrece una API oficial enterprise (desde $2,100-4,200/mes con compromiso de 3 meses). Para uso flexible, la mayoría de devs usan klingapi.com, fal.ai, PiAPI, o Segmind como wrappers.

## Modelos disponibles

| Modelo | ID | Caso |
|---|---|---|
| Kling 3.0 / O1 | `kling-video-o1` | Unified multimodal, máxima calidad |
| Kling 3.0 Omni | `kling-3-0-omni` | Audio nativo + lip-sync 5 idiomas |
| Kling 2.6 Pro | `kling-v2.6-pro` | Audio nativo + Motion Control |
| Kling 2.6 Std | `kling-v2.6-std` | Generación rápida con audio |
| Kling 2.5 Turbo | `kling-v2.5-turbo` | Máxima velocidad |

## Endpoints

| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/v1/videos/text2video` | Text-to-video |
| POST | `/v1/videos/image2video` | Image-to-video |
| GET  | `/v1/videos/{task_id}` | Estado/resultado |
| POST | `/v1/videos/extend` | Extender video |
| POST | `/v1/videos/lip-sync` | Lip-sync a video existente |

## Parámetros principales

| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `model` | string | ✓ | ID del modelo |
| `prompt` | string | ✓ | Descripción del video |
| `negative_prompt` | string | – | Qué evitar |
| `duration` | int | – | 5 o 10 segundos |
| `aspect_ratio` | string | – | `16:9`, `9:16`, `1:1` |
| `mode` | string | – | `standard` \| `professional` |
| `cfg_scale` | float | – | Adherencia al prompt (0–1) |
| `camera_control` | object | – | Control de cámara (pan, tilt, zoom, roll) |

## Ejemplo Python (text-to-video)

```python
import requests

API_KEY = "your_api_key"
BASE_URL = "https://api.klingapi.com"

response = requests.post(
    f"{BASE_URL}/v1/videos/text2video",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    },
    json={
        "model": "kling-v2.6-pro",
        "prompt": "A cat playing piano in a jazz club",
        "duration": 5,
        "aspect_ratio": "16:9",
        "mode": "professional"
    }
)

task_id = response.json()["task_id"]

# Polling
import time
while True:
    result = requests.get(
        f"{BASE_URL}/v1/videos/{task_id}",
        headers={"Authorization": f"Bearer {API_KEY}"}
    ).json()
    if result["status"] == "completed":
        print(result["video_url"])
        break
    elif result["status"] == "failed":
        break
    time.sleep(5)
```

## Ejemplo cURL

```bash
curl -X POST 'https://api.klingapi.com/v1/videos/text2video' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "kling-v2.6-pro",
    "prompt": "A cat playing piano",
    "duration": 5,
    "aspect_ratio": "16:9"
  }'
```

## Control de cámara (avanzado)

```json
{
  "camera_control": {
    "type": "simple",
    "config": {
      "horizontal": 0,
      "vertical": 0,
      "pan": -10,
      "tilt": 0,
      "roll": 0,
      "zoom": 0
    }
  }
}
```

## Notas importantes

- **Async:** todas las generaciones son tareas asíncronas con polling.
- **Std completa ~30s; Pro ~60s.**
- **Audio nativo (Omni/2.6):** soporta 5 idiomas con lip-sync; modo Pro cuesta 2× sin audio.
- **Links de video válidos por 24 horas** — descarga inmediatamente.
- **Webhooks** soportados para evitar polling.

## SDKs oficiales

```bash
pip install kling-api
npm install @kling-api/sdk
```

## Precios

- Kling 3.0: ~$0.10/seg
- Pro mode con audio: 2× del precio base
- Video 10s = 2× precio 5s

Ver: https://klingapi.com/pricing
