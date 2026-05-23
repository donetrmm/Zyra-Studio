# Setup API keys de proveedores (manual)

Pasos para conseguir y configurar las API keys de los modelos generativos. Pegar todo en el `.env.local` de la raíz. Las keys nunca se commitean al repo.

> **Fase 2 mínima**: solo `GEMINI_API_KEY` y `BFL_API_KEY` son obligatorias. Las demás se piden en fases posteriores pero conviene dejarlas listas.

## Mapa de variables → fase que las necesita

| Variable | Proveedor | Modelos | Fase |
|---|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio | Nano Banana Pro / Flash (imagen) | **2** |
| `BFL_API_KEY` | Black Forest Labs | FLUX 2 Pro (imagen fotorrealista) | **2** |
| `BFL_API_BASE_URL` | — | Base URL fija (`https://api.bfl.ai`) | 2 |
| `KLING_API_KEY` | klingapi.com | Kling v2.5/v2.6, Kling O1, Omni (video) | 3 |
| `KLING_API_BASE_URL` | — | Base URL del reseller | 3 |
| `ELEVENLABS_API_KEY` | ElevenLabs | TTS, voice clone, dubbing, FX | 3 |

## 1. Gemini API (Nano Banana)

1. https://aistudio.google.com/apikey → **Create API key**.
2. Cuenta con la que entres define la quota. Para el demo basta el tier gratis; si chocas con rate limits, mover a Vertex AI o pagar por uso.
3. Copia la key.
4. En `.env.local`:
   ```env
   GEMINI_API_KEY=AIza...
   ```

**Costo aproximado por imagen** (referencia, no se cobra a la app):

| Modelo | 1K | 2K | 4K |
|---|---|---|---|
| `gemini-3-pro-image-preview` | $0.08 | $0.12 | $0.16 |
| `gemini-3.1-flash-image-preview` | menor | menor | — |

**Verificar que funciona** (terminal):

```bash
curl -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts":[{"text":"A simple red circle on white background"}]}],
    "generationConfig": {"responseModalities":["IMAGE"],"imageConfig":{"imageSize":"1K","aspectRatio":"1:1"}}
  }' | head -c 400
```

Debe devolver JSON con `candidates[0].content.parts[0].inlineData.data` (base64). Si responde 401/403 la key está mal; si 429, hay rate limit activo.

> Más detalle de la API: `docs/modelos/03-nano-banana-pro.md`.

## 2. Black Forest Labs (FLUX 2 Pro)

1. https://bfl.ai → **Get started** / **Sign in**.
2. Después de crear cuenta, ir a la sección **API Keys** del dashboard y generar una nueva.
3. BFL es de pago por créditos — agregar crédito mínimo desde **Billing**. Una imagen 1MP ≈ $0.03.
4. Copia la key.
5. En `.env.local`:
   ```env
   BFL_API_KEY=
   BFL_API_BASE_URL=https://api.bfl.ai
   ```

> `BFL_API_BASE_URL` no se usa hoy en el adapter (que apunta directo a `api.bfl.ai`), pero queda reservado para overrides regionales (`api.eu.bfl.ai` / `api.us.bfl.ai`) o para apuntar a un proxy/Together AI más adelante.

**Verificar** (terminal):

```bash
curl -X POST 'https://api.bfl.ai/v1/flux-2-pro-preview' \
  -H 'accept: application/json' \
  -H "x-key: $BFL_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"a cat","width":512,"height":512}'
```

Debe devolver `{"id":"...","polling_url":"https://api.bfl.ai/v1/get_result?id=..."}`. Si responde 401, key inválida; si 402, no hay créditos.

> Más detalle: `docs/modelos/04-flux-2-pro.md`.

## 3. ElevenLabs (Fase 3)

1. https://elevenlabs.io → Sign up.
2. **Profile → API Keys** → generar.
3. Free tier: 10K chars/mes, voice clone instantáneo en Creator+ ($5/mes).
4. En `.env.local`:
   ```env
   ELEVENLABS_API_KEY=
   ```

> Más detalle: `docs/modelos/05-elevenlabs.md`.

## 4. Kling (Fase 3)

Kling no expone API oficial pública aún. Se accede vía resellers (klingapi.com, fal.ai, Replicate). El spec asume `klingapi.com`.

1. https://klingapi.com → Sign up → Dashboard → API Keys.
2. Cargar créditos mínimos (el plan de prepago se cobra por segundo de video).
3. En `.env.local`:
   ```env
   KLING_API_KEY=
   KLING_API_BASE_URL=https://api.klingapi.com
   ```

> Más detalle: `docs/modelos/02-kling-3.0.md`.

## 5. QStash (Fase 3)

1. https://upstash.com → Console → **QStash**.
2. Crear team / proyecto si no existe.
3. Capturar:
   ```env
   QSTASH_TOKEN=
   QSTASH_CURRENT_SIGNING_KEY=
   QSTASH_NEXT_SIGNING_KEY=
   ```
4. Free tier: 500 mensajes/día (suficiente para el demo).

## 6. `.env.local` completo

Tras conseguir las keys de las fases que vas a correr:

```env
# Supabase (de docs/setup/supabase.md §2)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Proveedores IA
GEMINI_API_KEY=
KLING_API_KEY=
KLING_API_BASE_URL=https://api.klingapi.com
BFL_API_KEY=
BFL_API_BASE_URL=https://api.bfl.ai
ELEVENLABS_API_KEY=

# QStash (fase 3)
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Después de modificar `.env.local`, reiniciar `pnpm dev` — Next.js no rehidrata variables en hot reload.

## 7. Reglas de seguridad

- **`.env.local` está en `.gitignore`**, no commitearlo nunca. Si por error queda en un commit: rotar todas las keys que aparezcan ahí antes de hacer push.
- Las keys de IA solo se leen server-side desde adapters en `lib/providers/*.ts`. Si las necesitas en cliente, hay un bug — el cliente jamás debe ver `GEMINI_API_KEY` ni `BFL_API_KEY`.
- En Vercel: configurar las mismas variables en **Project Settings → Environment Variables** (Production + Preview). No reusar entre proyectos.
- Rotar keys al cerrar el demo si el repo se vuelve público.

## 8. Smoke test post-setup

Después de pegar las keys y reiniciar `pnpm dev`:

1. Login en `/login` con el admin.
2. `/app/create/image` → prompt simple (ej. "una manzana roja sobre fondo blanco") → modelo **Nano Banana Pro 1K** (cuesta 60 créditos) → **Generar**.
3. La imagen debe aparecer en <30s en el panel derecho y el balance debe bajar 60 en vivo.
4. Cambiar modelo a **FLUX 2 Pro 1MP** (25 créditos) → generar otra vez → debe completar.
5. `/app/library` → ambas imágenes presentes con thumbnail.

Si la generación falla:
- **`provider_error: GEMINI_API_KEY no configurada`** → key vacía o no se leyó (reiniciaste `pnpm dev`?).
- **`provider_error: Auth inválida`** → key con typo o expirada.
- **`provider_error: Créditos insuficientes en BFL`** → cargar saldo en bfl.ai/billing.
- **`safety`** → el prompt o las referencias dispararon el filtro; cambiarlo. Los créditos se devuelven automáticamente.
