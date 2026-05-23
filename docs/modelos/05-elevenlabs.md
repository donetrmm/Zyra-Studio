# ElevenLabs — API Documentation

**Caso de uso:** Text-to-speech de alta calidad, voice cloning, doblaje, audiobooks, narración expresiva. Mejor naturalidad y soporte de español latino del mercado.

## Acceso

- **Documentación oficial:** https://elevenlabs.io/docs/api-reference
- **Base URL:** `https://api.elevenlabs.io`
- **Auth:** Header `xi-api-key: $ELEVENLABS_API_KEY`
- **SDKs oficiales:** Python, JavaScript/TypeScript (también Flutter, Swift, Kotlin para Agents)

## Modelos TTS principales

| Modelo | ID | Uso |
|---|---|---|
| **Eleven v3** | `eleven_v3` | Máxima expresividad, 70+ idiomas |
| Multilingual v2 | `eleven_multilingual_v2` | Alta calidad, 32 idiomas, español excelente |
| Flash v2.5 | `eleven_flash_v2_5` | Real-time, ~75ms latencia |

## Endpoints principales

| Método | Endpoint | Función |
|---|---|---|
| POST | `/v1/text-to-speech/{voice_id}` | Generar audio |
| POST | `/v1/text-to-speech/{voice_id}/stream` | Stream de audio |
| GET | `/v1/voices` | Listar voces disponibles |
| POST | `/v1/voices/add` | Voice cloning (instant) |
| POST | `/v1/dubbing` | Doblaje multilingual |
| POST | `/v1/sound-generation` | Sound effects |
| POST | `/v1/speech-to-speech/{voice_id}` | Voice changer |
| WSS | `/v1/text-to-speech/{voice_id}/stream-input` | WebSocket streaming |

## Parámetros TTS

| Parámetro | Tipo | Descripción |
|---|---|---|
| `text` | string | Texto a convertir |
| `model_id` | string | ID del modelo |
| `voice_settings.stability` | float | 0–1 (consistencia) |
| `voice_settings.similarity_boost` | float | 0–1 (fidelidad a la voz) |
| `voice_settings.style` | float | 0–1 (exageración estilística) |
| `voice_settings.use_speaker_boost` | bool | Mejora claridad |
| `language_code` | string | ISO 639-1 (ej. `es`) |
| `output_format` | string | `mp3_44100_128`, `pcm_24000`, etc. |

## Ejemplo cURL (básico)

```bash
curl -X POST https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hola, bienvenido al sistema.",
    "model_id": "eleven_multilingual_v2",
    "voice_settings": {
      "stability": 0.5,
      "similarity_boost": 0.75
    }
  }' \
  --output speech.mp3
```

## Ejemplo Python

```python
from elevenlabs.client import ElevenLabs
from elevenlabs import play

client = ElevenLabs(api_key="YOUR_API_KEY")

audio = client.text_to_speech.convert(
    voice_id="21m00Tcm4TlvDq8ikWAM",  # Rachel
    text="Hola, bienvenido al sistema.",
    model_id="eleven_multilingual_v2",
    voice_settings={
        "stability": 0.5,
        "similarity_boost": 0.75,
        "style": 0.0,
        "use_speaker_boost": True
    },
    output_format="mp3_44100_128"
)

with open("output.mp3", "wb") as f:
    for chunk in audio:
        f.write(chunk)
```

## Ejemplo JavaScript (streaming)

```javascript
import { ElevenLabsClient } from "elevenlabs";

const client = new ElevenLabsClient({ apiKey: "YOUR_API_KEY" });

const audio = await client.textToSpeech.convertAsStream(
  "21m00Tcm4TlvDq8ikWAM",
  {
    text: "Hola, bienvenido.",
    model_id: "eleven_flash_v2_5",
    voice_settings: { stability: 0.5, similarity_boost: 0.75 }
  }
);

for await (const chunk of audio) {
  // procesar chunk
}
```

## Voice cloning (instant)

```python
voice = client.voices.add(
    name="Mi Voz",
    files=["sample1.mp3", "sample2.mp3"],  # 1-2 min de audio limpio
    description="Voz personalizada para narración"
)
print(voice.voice_id)
```

## Prompting expresivo (Eleven v3)

Soporta tags inline para emociones:

```
"En tierras de Eldoria vivía un dragón. [sarcastically] No el tipo 'quemar todo'... [giggles] pero era gentil. [whispers] Hasta los pájaros callaban."
```

Tags soportados: `[whispers]`, `[laughs]`, `[sighs]`, `[sarcastically]`, `[excited]`, etc.

## Pausas y pronunciación

```xml
Hola. <break time="2s" /> ¿Cómo estás?
```

Diccionarios de pronunciación disponibles para términos técnicos/nombres propios.

## Formatos de salida

| Formato | Uso |
|---|---|
| `mp3_44100_128` | Default, balance calidad/tamaño |
| `mp3_44100_192` | Calidad alta (Creator+) |
| `pcm_24000`, `pcm_44100` | PCM raw |
| `ulaw_8000` | Telefonía |

## Idiomas (Multilingual v2 / v3)

70+ idiomas incluyendo: en, **es**, pt, fr, de, it, pl, hi, ja, ko, zh, ar, ru, nl, tr, sv, id, vi, etc.

Latino LatAm: español latino con expresividad excelente, voces dedicadas.

## Capacidades adicionales

- **Speech-to-Text (Scribe v2):** 90+ idiomas, timestamps, multichannel
- **Music API:** generación musical
- **Sound Effects:** SFX desde prompt
- **Audio Isolation:** eliminar ruido
- **Dubbing:** doblaje multi-idioma con lip-sync
- **Voice Design:** crear voces desde texto
- **Forced Alignment:** sincronización de subtítulos

## Pricing & créditos

- **TTS:** 1 crédito = 1 caracter
- **STT:** por minuto de audio
- **Free:** 10,000 chars/mes
- **Starter ($5/mes):** 30,000 chars
- **Creator ($22/mes):** 100,000 chars + voz profesional
- **Pro ($99/mes):** 500,000 chars
- **PAYG** desde Starter

Créditos resetean mensual, roll-over hasta 2 meses.

## Rate limits y errores

- 429: rate limit (exponential backoff)
- 401: auth fallida
- 400: request inválido
- WebSocket para streaming persistente

## Compliance

- Contenido API es **comercialmente licenciado**
- Music requiere licencia adicional para ads/film/TV/games
- HIPAA: contactar Sales para BAA
- Zero retention disponible (enterprise) con `enable_logging: false`

## Recursos

- API reference completo: https://elevenlabs.io/docs/api-reference
- Voice library: https://elevenlabs.io/app/voice-library
- Llms.txt para agentes IA: https://elevenlabs.io/docs/llms.txt
