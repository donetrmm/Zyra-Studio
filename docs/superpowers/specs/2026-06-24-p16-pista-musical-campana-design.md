# P16 — Pista de referencia de ritmo en campaña

**Fecha:** 2026-06-24
**Tanda:** P1 (segunda entrega; sucede a P0 = P14/P20/P21 y a P14b)
**Esfuerzo:** M
**Estado:** diseño aprobado, pendiente de plan de implementación

## Origen

Principio P16 del análisis Higgsfield (`docs/Generación de videos con IA/hallazgos-higgsfield-completo.md`, ficha P16): usar una pista musical como **referencia** para que la generación sincronice su energía y sus beats. NO se clona ningún modelo de Higgsfield; se adapta el principio a nuestro stack.

## Qué es (y qué NO es)

Seedance 2.0 acepta audio **solo como referencia** (`reference_audios`, hasta 3 archivos, **≤15s combinados, <15MB c/u, modo R2V**; ver `docs/modelos/06-seedance-2.md`). El audio guía **ritmo, beats, mood y dinámica**, y el modelo genera su **propio audio nativo sincronizado** a esa referencia.

- **SÍ es:** un ancla de ritmo/energía. El clip de audio del usuario orienta el beat y la energía del video generado.
- **NO es:** una banda sonora real muxeada. El video exportado **no contiene la canción literal** del usuario; contiene audio generado por el modelo que sigue el beat de la referencia. La banda sonora real (mux en post con ffmpeg) es un feature futuro, fuera de alcance.

Decisión confirmada en brainstorming: **referencia de ritmo/beat**, nivel **campaña**, fuente **solo subida**.

## Estado actual (la brecha)

El **pipe aguas abajo ya existe y funciona**:

- El compiler de Seedance consume `ctx.audioRefPath` y lo emite como referencia `@audio1` (`lib/prompt-director/compilers/seedance.ts:248-250`), y omite la dirección de score textual cuando hay pista (`seedance.ts:446`).
- `enqueueBatch` extrae la referencia de audio compilada a `generations.params.referenceAudioPaths` (`lib/campaigns/orchestrator.ts:819,869`).
- El worker firma `referenceAudioPaths` (`lib/jobs/handlers/seedance.ts:65-79`) y el provider los manda como `reference_audios` a ModelArk/Atlas (`lib/providers/seedance.ts:184,297`).
- La **subida de audio ya existe** end-to-end: `uploadMediaReferenceFile` (`lib/media-references/upload-client.ts`) maneja audio (mp3/wav, ≤15MB), crea una fila `media_references type='audio'` con `storage_url` en el bucket `references`.

**El único eslabón faltante es poblar `ctx.audioRefPath` aguas arriba.** Hoy nadie lo setea en el flujo de campaña: `directorContextFor` (`orchestrator.ts:245-281`) ni siquiera lo referencia, y `index.ts:71` solo lo limpia para el storyboard.

## Diseño

Nivel **campaña**: una pista por campaña, propagada a todos los clips de todas sus secuencias.

### 1. Migración `043_campaign_music_ref.sql`

```sql
alter table campaigns
  add column music_ref_id uuid references media_references(id) on delete set null;
```

- Aditiva. `on delete set null`: si se borra el audio referenciado, la campaña no se rompe (queda sin pista).
- No requiere cambios de RLS: `campaigns` ya tiene sus policies; la columna hereda el control de la fila. El FK a `media_references` no expone datos nuevos.
- **NUNCA modificar una migración ya aplicada** — esto es un archivo nuevo en orden.

### 2. Schema (zod) + server actions

- `CreateCampaignStudioSchema` (`lib/schemas/campaigns.ts`) gana `musicRefId: z.string().uuid().optional()`.
- `createCampaignStudioAction` (`server-actions/campaigns.ts:219-350`) persiste `music_ref_id` en el insert (`campaigns.ts:327-345`).
- Nueva `setCampaignMusicAction(campaignId: string, musicRefId: string | null)`:
  - Valida ownership de la campaña (patrón de las demás server actions del dominio).
  - Si `musicRefId` no es null, valida que ese `media_reference` exista, pertenezca al workspace y sea `type='audio'`.
  - Actualiza `campaigns.music_ref_id` (set o clear).
  - Permite adjuntar/cambiar/quitar la pista después de crear la campaña y antes de generar.

### 3. Threading de contexto (sin migración)

- `CampaignContext` (`orchestrator.ts:98-107`) gana `audioRefPath?: string`.
- `loadCampaignContext` (`orchestrator.ts:163-243`) resuelve `campaign.music_ref_id` → `media_references.storage_url` (el storage path, firmable por el worker igual que el resto de referencias), con el mismo patrón `resolvePaths` que ya usa para producto/cast. El parámetro `campaign` que recibe debe incluir `music_ref_id`.
- `directorContextFor` (`orchestrator.ts:245-281`) setea `audioRefPath: ctx.audioRefPath` en el `DirectorContext` que devuelve.

### 4. Propagación a clips encadenados

`advanceSequenceChain` / la construcción de continuación (`orchestrator.ts:340-599`) **no** pasa por `directorContextFor`; arma `generations.params` directo (insert en `orchestrator.ts:509-543`). Se agrega:

```ts
referenceAudioPaths: ctx.audioRefPath ? [ctx.audioRefPath] : undefined
```

a ese params, para que los clips 2+ de una secuencia también hereden la pista. Sin esto, solo el primer clip de cada secuencia llevaría la referencia.

### 5. UI — control en el wizard

- Sección nueva "Pista musical (opcional)" en `components/campaigns/CampaignStudioWizard.tsx`, junto a las secciones de idioma/aspect-ratio (~`:471-526`).
- Reutiliza la subida de media-references existente (`uploadMediaReferenceFile`) y el preview `components/generation/WavePlayer.tsx` (o `AudioPreview.tsx`).
- Estado: el `musicRefId` resultante se pasa a `createCampaignStudioAction({...})` (`:131-142`). Si el usuario quita/cambia la pista tras crear, usa `setCampaignMusicAction`.
- Sin emojis; dark mode; componentes shadcn primero; el control es opcional y no bloquea la creación.

### 6. Guard de duración (≤15s), client-side

- Al seleccionar el archivo, leer la duración en el navegador con un elemento `<audio>` (`audio.duration`, cero dependencias nuevas).
- Si la duración > 15s, **bloquear** la selección con un mensaje claro ("La pista de referencia debe durar máximo 15 segundos; usa un clip corto del beat").
- Esto evita ffmpeg (no muxeo, no recorte server-side) y evita un 4xx del proveedor que quemaría un crédito reservado.
- El límite de tamaño (15MB) ya lo aplica `uploadMediaReferenceFile`; el guard de duración es adicional y vive en el control del wizard.

## Interacciones de borde (ya resueltas, sin cambio de código)

- **Score textual vs referencia:** `seedance.ts:446` ya hace `if (generateAudio && !ctx.audioRefPath)` → con pista, omite la dirección de score descrita y deja que el modelo sincronice al beat de la referencia.
- **Tope de 12 referencias:** el audio es la prioridad más baja y ya se recorta primero (`seedance.ts:253-259`).
- **Toggle `campaign_items.audio`:** sigue gobernando si se genera audio; la pista solo influye cuando aplica.

## Componentes y archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/043_campaign_music_ref.sql` | NUEVO — columna `music_ref_id` |
| `lib/schemas/campaigns.ts` | `musicRefId?` en `CreateCampaignStudioSchema` |
| `server-actions/campaigns.ts` | persistir `music_ref_id` en create + `setCampaignMusicAction` |
| `lib/campaigns/orchestrator.ts` | `audioRefPath` en `CampaignContext`; resolución en `loadCampaignContext`; set en `directorContextFor`; propagación en `advanceSequenceChain` |
| `components/campaigns/CampaignStudioWizard.tsx` | sección "Pista musical" + guard de duración |

## Tests

- **Compiler (ya existe):** `lib/prompt-director/prompt-director.test.ts:423` verifica que `ctx.audioRefPath` se emite como referencia `@audio1`. Sin cambio.
- **orchestrator:** unit test puro de `directorContextFor` — setea `audioRefPath` cuando el `CampaignContext` lo trae; `undefined` cuando no. (Función pura, sin DB.)
- **Server action:** test de `setCampaignMusicAction` — rechaza un `media_reference` que no es `type='audio'` o no es del workspace; setea/limpia correctamente. Sin llamar APIs reales (mock del cliente supabase siguiendo el patrón de los tests de server-actions existentes, si lo hay; si no, cubrir la lógica de validación pura).
- **Fuera de tests automáticos:** el guard de duración (UI) y el render con beat real = smoke del usuario con API/Atlas (memoria `feedback_no_real_api_in_tests`).

## Decisiones inmutables — verificación

- **>60s / QStash:** sin cambio; la pista es solo otra referencia firmada en el params del job existente; el worker ya las maneja en el flujo asíncrono.
- **URLs de proveedor nunca al cliente:** la pista es un storage path interno (`media_references.storage_url` en `references`), firmado server-side por el worker; el cliente nunca ve URLs del proveedor.
- **Créditos vía SQL atómicas:** sin cambio; no se toca `reserve/confirm/refund`.
- **RLS última línea:** las server actions validan ownership + `type='audio'` con zod antes de tocar la DB; la migración es aditiva y hereda las policies de `campaigns`.
- **Service role solo server-side:** sin cambio.
- **No deps pesadas (Vercel Hobby):** el guard de duración usa el `<audio>` del navegador; cero ffmpeg, cero librerías nuevas.

## Fuera de alcance

- Banda sonora real muxeada en el video exportado (feature futuro, requiere ffmpeg/post-producción).
- Biblioteca curada de pistas predefinidas.
- Pista por secuencia o por clip (override). El nivel campaña cubre el caso; per-secuencia/clip es YAGNI hasta que haya demanda.
- Selector de media-references ya subidas (solo subida nueva en el MVP).

## Verificación posterior

- `pnpm typecheck` limpio.
- Suite verde (incluye los tests nuevos de orchestrator y server action).
- Migración aplicada en el proyecto Supabase (`043` en `list_migrations`).
- Smoke del usuario: crear una campaña con una pista ≤15s, generar una secuencia y confirmar que (a) el clip 1 y los clips encadenados llevan `referenceAudioPaths` en `generations.params`, y (b) el video generado sincroniza energía/beat a la referencia.
