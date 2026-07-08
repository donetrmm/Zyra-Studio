# Migración de Gemini y Nano Banana a Vercel AI Gateway

**Fecha:** 2026-07-08
**Estado:** aprobado (diseño); pendiente de plan de implementación
**Rama prevista:** `feat/ai-gateway-providers` (desde `feat/ingesta-prompt-maestro`)

## Objetivo

Unificar billing y keys de los modelos de Google en Vercel: todas las llamadas a
Gemini (texto) y Nano Banana (imagen) pasan por Vercel AI Gateway con una sola
`AI_GATEWAY_API_KEY`. Veo (video) queda fuera — ver sección Veo.

## Contexto técnico que condiciona el diseño

- AI Gateway **no expone un endpoint compatible con la API nativa de Gemini**
  (`generateContent`). Solo ofrece: AI SDK, OpenAI-compat, Anthropic Messages y
  OpenResponses. Migrar no es cambiar la URL: es traducir el transporte.
- El repo hace 13 llamadas REST nativas a `generativelanguage.googleapis.com`
  con `GEMINI_API_KEY`: 11 módulos de texto, Nano Banana y Veo.
- Los 11 módulos de texto comparten el mismo patrón: `systemInstruction` +
  `generationConfig` (`temperature`, `maxOutputTokens` calibrado por módulo,
  `responseMimeType`, `thinkingConfig: { thinkingBudget: 0 }`) y varios llevan
  imágenes como `inline_data`.
- El video del gateway (`experimental_generateVideo`) es bloqueante: el gateway
  hace el polling con la conexión HTTP abierta y no expone el operation name.
  Incompatible con la decisión inmutable "todo >60s pasa por QStash con polling
  re-encolado" — un retry de QStash regeneraría (y cobraría) el video completo.

## Decisiones tomadas (con el usuario, 2026-07-08)

1. **Motivación:** unificar billing/keys en Vercel.
2. **Alcance:** 11 módulos de texto + Nano Banana. Veo queda directo a Google.
3. **Auth:** `AI_GATEWAY_API_KEY` estática (no OIDC: expira cada ~24h en local y
   el CLI de Vercel no está instalado).
4. **Transporte:** AI SDK v6 (`ai@^6`, única dependencia nueva) con model
   strings `google/...` que rutean solos por el gateway.

## Arquitectura

### 1. Capa de transporte compartida (nueva): `lib/providers/gateway.ts`

Un helper `gatewayText()` sobre `generateText` del AI SDK. Interfaz pensada para
que los 11 módulos de texto cambien SOLO el transporte:

- Entrada: `model` (slug interno, ej. `gemini-2.5-flash`), `system`, partes
  (texto + imágenes `{ mimeType, base64 }`), `temperature`, `maxOutputTokens`,
  `json: boolean`, `thinkingBudget` (default 0 — calibrado: los thoughts
  consumen `maxOutputTokens`).
- Salida: texto crudo (string). El parseo/validación sigue siendo responsabilidad
  de cada módulo (sin cambios).
- Mapeo de slugs interno → gateway (`gemini-2.5-flash` →
  `google/gemini-2.5-flash`) vive SOLO aquí. Los slugs internos en DB, schemas,
  estimator y UI no cambian (cero migraciones).
- `thinkingConfig` y demás opciones nativas viajan por
  `providerOptions.google` (passthrough del gateway). Verificar en implementación
  el nombre exacto del namespace de provider options que el gateway rutea a
  Google (AI Studio vs Vertex).
- Errores del SDK (`APICallError`) se traducen a `ProviderError` conservando la
  semántica actual: 429 → `rate_limit` (con los mismos reintentos), 401/403 →
  `auth`, filtro de contenido → `safety`, 5xx → `server` (retryable).

### 2. Módulos de texto (11) — cambian solo el transporte

ingest, format-matcher, refine/gemini, brief, clarify, analyze-kit,
describe-character, reference-analysis, light-profile, storyboard-expand-check,
prompt-enhancer.

Cada uno reemplaza su `fetch` nativo + parseo de `candidates` por una llamada a
`gatewayText()`. **Intactos:** prompts/system, `extractJson`, schemas zod,
fallbacks (ej. `fallbackIngestResult`), caps calibrados (`maxOutputTokens`
32768 en ingest/matcher, ver memoria de output truncado) y temperaturas.

### 3. Nano Banana: `lib/providers/nano-banana.ts`

Migra el transporte a AI SDK con `google/gemini-3-pro-image-preview`:

- `generationConfig.responseModalities` + `imageConfig` (aspectRatio,
  imageSize) → `providerOptions.google`. La paridad de aspect ratio y
  resolución se conserva.
- `buildBody()` (pura, testeada) se convierte en el builder equivalente de
  mensajes AI SDK conservando TODA la lógica: chat multi-turn cuando hay
  `thoughtSignature`, degradación a single-turn cuando falta, descarte de refs
  en chat, `chatReferences`, directivas de prompt.
- `interpretResponse()` se adapta al shape del AI SDK (`result.files` +
  `finishReason` + `providerMetadata`) conservando la clasificación de errores:
  safety (`IMAGE_SAFETY`, `PROHIBITED_CONTENT`, …), `MAX_TOKENS`, sin-imagen.
- El fallback por rechazo del sig replayado (hoy 404 NOT_FOUND →
  `isChatSignatureRejection` → retry single-turn) se conserva, adaptando la
  detección al error que surface el SDK/gateway.
- Post-proceso `noBackground` (sharp) no cambia.

**Riesgos aceptados, con red de seguridad:**

| Riesgo | Mitigación |
|---|---|
| El gateway no devuelva `thoughtSignature` en `providerMetadata` | El adapter ya degrada a single-turn cuando falta el sig (ruta existente y probada). Se pierde coherencia narrativa en refinados encadenados hasta validar con smoke test del usuario. |
| `useGrounding` (`google_search` tool) no pase por el gateway | Verificar en implementación; si no pasa, flagear antes de mergear (no resolver en silencio). |
| El slug `google/gemini-3-pro-image-preview` no exista en el gateway | Verificar contra `GET https://ai-gateway.vercel.sh/v1/models` en implementación; elegir el slug equivalente real. |

### 4. Veo — sin cambios (decisión explícita)

`lib/providers/veo.ts` sigue nativo con `GEMINI_API_KEY`. Razón: el gateway solo
ofrece video bloqueante sin operation name; re-encolarlo por QStash es imposible
y un retry pagaría el video dos veces. Se reevalúa si el gateway publica una API
async de video. `GEMINI_API_KEY` queda documentada en `.env.example` como
"solo Veo".

## Config, env y docs

- `pnpm add ai` (v6). Sin `@ai-sdk/google` ni `@ai-sdk/gateway` explícitos salvo
  que la implementación demuestre que hacen falta.
- `.env.example`: agregar `AI_GATEWAY_API_KEY` con comentario; anotar
  `GEMINI_API_KEY` como solo-Veo.
- Vercel: habilitar AI Gateway en el proyecto y crear la key (pasos para el
  usuario en el plan).
- Actualizar `docs/modelos/` (Gemini y Nano Banana) y la sección de providers de
  `docs/zyra-studio-spec.md` en paralelo (regla de CLAUDE.md).

## Fuera de alcance

- Veo por gateway (ver arriba).
- Failover a otros providers, cache del gateway, rate limits por usuario, tags
  de cost tracking — se pueden añadir después; este trabajo es solo el cambio de
  transporte y billing.
- Cambios en el sistema de créditos interno (estimator no cambia).
- FLUX, Kling/fal, ElevenLabs, Seedance: no se tocan.

## Testing y verificación

- Tests unitarios sin red (regla del repo): los builders puros conservan tests
  deterministas adaptados al nuevo shape; el transporte se mockea.
- `pnpm build` obligatorio (no solo typecheck — gotcha de `'use server'`).
- Smoke tests con API real (los corre el usuario):
  1. Ingesta de prompt maestro + matcher (texto/JSON con caps altos).
  2. Panel Nano Banana nuevo con aspect ratio y resolución.
  3. Refinado encadenado de panel (valida chat multi-turn / thoughtSignature).
  4. Un video Veo (regresión: debe seguir funcionando igual).
