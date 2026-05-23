# Fase 3 — Video, Audio y Cola de Jobs

> **Día 4–5 · ~20 horas · ~28% del proyecto**
>
> Aquí entra la cola QStash (obligatoria porque Veo y Kling exceden 60s), los adapters de Kling/Veo/ElevenLabs y las UI de creación de video y audio. Es la fase más larga porque establece el patrón que el resto de la app usa.

## Pre-requisitos

- Fases 1 y 2 completas.
- API keys: `KLING_API_KEY`, `ELEVENLABS_API_KEY`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`.
- Cuenta Upstash con QStash habilitado (proyecto creado para obtener el token).

## Objetivo

Al cerrar la fase:
1. El worker `/api/jobs/process` procesa cualquier generación encolada (imagen pesada, video, audio largo) con polling recursivo a través de QStash.
2. El usuario genera videos con Veo 3.1 (premium) o Kling 2.6 (volumen) desde `/app/create/video`, ve el progreso en vivo, puede cancelar.
3. El usuario genera voces con ElevenLabs (TTS multilingual, flash, v3 con tags expresivos) desde `/app/create/audio`.
4. El usuario clona una voz (sube samples → ElevenLabs cloning → la voz aparece en `/app/voices`).
5. Las generaciones de imagen de fase 2 se migran al worker (uniformidad).

## Tareas en orden

### Día 4 — Cola, worker y adapters

#### 1. Setup QStash (1h)

- `lib/jobs/queue.ts`: cliente `Client({ token })` con helper `publishJSON({ url, body, delay })`.
- `lib/jobs/receiver.ts`: `Receiver({ currentSigningKey, nextSigningKey })` para verificar firma.
- Setear webhooks en Upstash si se va a usar el dashboard de logs (opcional).

#### 2. Worker `/api/jobs/process` (3h)

`app/api/jobs/process/route.ts`:

```typescript
export const maxDuration = 60;
export const runtime = 'nodejs';

export async function POST(req: Request) {
  // 1. Verificar firma QStash (rechazar 401 si falla)
  // 2. Parse body: { generationId, action }
  // 3. Cargar generación con service_role
  // 4. Si status terminal → ack y exit
  // 5. Si cancel_requested o now() > timeout_at → cancelar + refund
  // 6. Switch en action: 'submit' | 'poll'
  // 7. Switch en provider: cargar adapter correcto
  // 8. Ejecutar lógica del adapter
  // 9. Si necesita más polling → re-encolar con delay calculado
  // 10. Si completó → descargar, subir, thumbnail, confirm_credits, update
  // 11. Si falló → refund + status='failed'
}
```

Helper `nextDelay(provider, attempts)` según tabla de la sección 6 del spec.

#### 3. Adapter Veo (2h)

`lib/providers/veo.ts`:
- `submit(params)`: POST a `:predictLongRunning`, devuelve `operation.name` como `taskId`.
- `poll(taskId)`: GET a `/v1beta/{operation.name}`. Devuelve `{ status: 'processing' | 'done', result?, error? }`.
- `download(result)`: descarga el video desde `result.response.generateVideoResponse.generatedSamples[0].video.uri` autenticado con `x-goog-api-key`.
- Soporta los 3 modelos (Standard, Fast, Lite) y los 3 resoluciones.
- Inyecta `personGeneration: 'allow_adult'` siempre.
- Trunca `referenceImages` a 3 máx.

#### 4. Adapter Kling (2h)

`lib/providers/kling.ts`:
- `submit(params)`: switch en operación (`text2video`, `image2video`, `extend`, `lip-sync`). POST al endpoint correspondiente.
- `poll(taskId)`: GET a `/v1/videos/{task_id}`, mapea `status` ("processing" | "completed" | "failed").
- `download(result)`: descarga `result.video_url` (URLs Kling expiran a 24h, no urgente pero hazlo igual).
- Soporta los 5 modelos (`kling-video-o1`, `kling-3-0-omni`, `kling-v2.6-pro`, `kling-v2.6-std`, `kling-v2.5-turbo`).
- Implementa cancel: `POST /v1/videos/{task_id}/cancel` si existe.

#### 5. Adapter ElevenLabs (2h)

`lib/providers/elevenlabs.ts`:
- `tts({ text, voice_id, model_id, voice_settings, language_code })`: POST a `/v1/text-to-speech/{voice_id}`, devuelve buffer MP3.
- **Chunking obligatorio:** si `text.length > 4000`, dividir por frases (regex `[.!?]+\s`), llamar TTS por chunk con cap de 3000 chars cada uno, concatenar buffers MP3 (concat raw funciona en MP3).
- `soundEffect({ text })`: POST a `/v1/sound-generation`.
- `cloneVoice({ name, files })`: POST a `/v1/voices/add` con FormData multipart.
- `dubbing({ video_url, target_lang })`: POST a `/v1/dubbing`, devuelve `dubbing_id` para polling.

#### 6. Migrar generación de imagen al worker (1h)

- `submitGeneration` ahora siempre encola en QStash con `action: 'submit'` (sin importar provider).
- El worker decide si va síncrono (Nano Banana, ElevenLabs corto) dentro de la invocación o si necesita polling (Veo, Kling, FLUX).
- La UI mantiene el patrón: server action inserta `generations` → cliente se suscribe a Realtime → ve cambios de status.
- Probar que las generaciones de imagen de fase 2 siguen funcionando idéntico.

### Día 5 — UIs de video y audio

#### 7. Router de video y audio (0.5h)

- `selectVideoModel(params)` y `selectAudioModel(params)` de la sección 7 del spec, exactos.

#### 8. UI generación video (3.5h)

`/app/create/video/page.tsx`, layout 2 columnas como imagen:

**Controles:**
- `ModelSelector`: Veo 3.1 (premium), Veo Fast, Kling 2.6 Pro, Kling Turbo, Kling Omni (lip-sync). "Auto" usa el router.
- `PromptInput` + negative prompt.
- Params dinámicos por modelo:
  - Veo: aspect (16:9 / 9:16), duración (4/6/8s), resolución (720p/1080p/4K), toggle "Imagen inicial" (file picker), toggle "Último frame".
  - Kling: duración (5s/10s), modo (standard/professional), aspect, cfg_scale slider, camera_control collapsible.
- `ReferencesPanel` (reusa el de fase 2).
- `CostPreview` + `GenerateButton`.

**Preview:**
- Mientras procesa: video placeholder con progress bar + "Veo tarda hasta 6 min" + botón cancelar.
- Al completar: `<video controls autoPlay muted />` + botones (Descargar, Usar como referencia, Animar storyboard frame, Lip-sync con voz).

#### 9. UI generación audio (2.5h)

`/app/create/audio/page.tsx`:

**Controles:**
- Tabs: TTS / Sound Effect / Voice Clone.
- TTS:
  - Selector de voz (voces oficiales de ElevenLabs + voces clonadas del workspace).
  - Textarea (mostrar contador de chars y costo en vivo).
  - Selector de modelo (Multilingual v2 / Flash / V3) + idioma.
  - Sliders stability, similarity_boost, style.
  - Tags expresivos chip-picker (solo para V3).
- Sound Effect: solo prompt.
- Voice Clone: dropzone para 1-2 minutos de audio + nombre + descripción.

**Preview:**
- Mientras procesa: spinner.
- Al completar: `<audio controls>` + waveform opcional (wavesurfer.js o solo el `<audio>`) + botones (Descargar, Usar en pipeline voz+video).

#### 10. Página `/app/voices` (1h)

- Grid de `voice_clones` del usuario.
- Card con nombre, descripción, status, sample player.
- Botón "Probar voz" → modal con TTS rápido usando esa voz.
- Botón "Eliminar" → confirma → DELETE en `voice_clones` + opcionalmente `DELETE /v1/voices/{voice_id}` en ElevenLabs.

#### 11. Cancelación desde UI (1h)

- En el preview de video procesando: botón "Cancelar".
- Server action `cancelGeneration(id)`: setea `cancel_requested = true` (RLS valida que el user es dueño).
- El worker detecta la bandera en el siguiente tick y refunde.
- UI muestra estado `canceled` con icono distinto.

#### 12. Realtime de generations en la UI de creación (0.5h)

- En `/app/create/video` y `/app/create/audio`: suscribirse a la fila específica creada por `submitGeneration`.
- Status updates: `queued` → `processing` → `done` / `failed` / `canceled`.
- Mostrar `error_message` si falla.

#### 13. Smoke test integral (1h)

- Generar un Veo Fast 1080p 8s → llega en <3 min, se ve en preview, créditos descontados correctamente.
- Generar un Kling 2.6 Pro 5s → llega en <90s.
- Generar TTS de 5000 chars con Multilingual v2 → chunking funciona, MP3 final completo.
- Clonar voz con 2 samples → la voz aparece en `/app/voices` después de unos minutos.
- Cancelar un Veo a mitad de procesamiento → refund llega al balance.
- Provocar timeout (forzar `timeout_at = now()` en SQL) → worker marca failed + refund.
- Verificar consumo de QStash en su dashboard: no debe pasar de ~50 msgs por una sesión de prueba completa.

## Criterios de aceptación

- [ ] Worker procesa correctamente los 3 estados de cada provider (queued → processing → done) sin generaciones zombies.
- [ ] `poll_attempts` se incrementa y el `MAX_POLLS` corta jobs colgados (probar con un provider mockeado que nunca complete).
- [ ] `timeout_at` corta jobs aunque QStash siga entregando polls.
- [ ] Cancelación llega al worker dentro del próximo poll y dispara refund.
- [ ] Output siempre se sirve desde Supabase Storage (signed URL `*.supabase.co`), nunca desde el proveedor original. Verificable en la url del `<video>` o `<img>` en el browser.
- [ ] Thumbnail de video usa `-ss 0 -frames:v 1` (verificable midiendo tiempo de procesamiento de un Veo 4K — debe ser <5s para el thumbnail).
- [ ] TTS de 6000 chars produce un MP3 único reproducible, no varios archivos.

## Lo que NO entra en esta fase

- Brand kits, characters, presets (fase 4).
- Storyboard, auto-variaciones, smart crop, comparador A/B, pipeline voz+video (fase 4).
- Timeline editor, dubbing (fase 5).
- Prompt assistant (fase 4).
- Plantillas comunitarias (fase 5).

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| QStash devuelve 429 en burst de varias generaciones simultáneas | Server action retorna error claro "demasiados jobs en cola, intenta en un minuto"; usuario reintenta |
| Veo Lite o Fast en algún momento devuelve un formato distinto | Empezar SOLO con Veo Standard 1080p; agregar Fast/Lite cuando Standard esté validado |
| Concatenar MP3 raw genera artefactos audibles en transiciones | Probar primero con 2 chunks; si suena raro, usar `lamejs` para re-encodear |
| Worker excede 60s en una invocación específica (FLUX + thumbnail) | Cada paso debe ser <50s; si se acerca, hacer doble fase (download en una invocación, thumbnail en la siguiente) |
| QStash free tier se agota mid-demo | Tener un script `/api/jobs/poll-fallback` que se puede llamar manualmente desde el navegador como backup |
| Kling cancel endpoint devuelve error inesperado | Capturar y continuar — la cancelación local + refund siguen siendo válidas aunque el provider no coopere |
