# Fase 5 — Polish, Timeline y Preparación de Demo

> **Día 7 · ~10 horas · ~14% del proyecto**
>
> El último día se enfoca en lo que el revisor verá: timeline editor, plantillas comunitarias, dubbing, cleanup automático, datos seed creíbles, refinamientos UI y un guion de demo. Si en fases previas algo quedó debiendo, este día es el buffer para cerrarlo antes de polish.

## Pre-requisitos

- Fases 1–4 completas.
- App desplegada en Vercel con dominio funcional.

## Objetivo

Al cerrar la fase:
1. El timeline editor permite concatenar videos + agregar pistas de audio y exportar MP4.
2. Las plantillas comunitarias (presets públicos) están funcionando con un puñado precargado.
3. Dubbing automático genera versiones doblabas de un video.
4. El cleanup automático corre cada noche.
5. La cuenta demo tiene contenido pre-existente creíble (campañas, brand kits, personajes, generaciones de ejemplo).
6. Hay un guion de demo de 5-7 minutos documentado.

## Tareas en orden

### 1. Cleanup endpoint (1h)

`app/api/jobs/cleanup/route.ts`:
- Verificar firma QStash.
- Ejecutar las 4 reglas de limpieza (sección 14 del spec):
  - DELETE generations failed/canceled >7d.
  - DELETE media_references con source='generation' y source_generation_id is null y >24h.
  - List `outputs/` bucket, comparar contra `generations.output_url` vivos, borrar lo huérfano >24h.
  - DELETE notifications con read_at not null y >30d.
- Log de cada paso (count antes/después) para depurar.

Crear schedule en Upstash:
```bash
curl -X POST https://qstash.upstash.io/v2/schedules/<URL>/api/jobs/cleanup \
  -H "Authorization: Bearer $QSTASH_TOKEN" \
  -H "Upstash-Cron: 0 3 * * *"
```

### 2. Timeline editor (3h)

`/app/projects/[id]/timeline` o tab dentro de `/app/projects/[id]`:

- UI: línea de tiempo horizontal con 3 pistas (video, voz, música/SFX).
- Sidebar izquierda: biblioteca filtrada del proyecto (videos generados, audios disponibles).
- Drag-drop de assets a las pistas.
- Cada clip en la pista: trim handles (inicio/fin), drag para reordenar.
- Preview centrado: `<video>` que renderiza el estado actual (solo el primer clip por simplicidad inicial; full preview es complejo).
- Botón "Exportar MP4 1080p" → procesamiento con `ffmpeg.wasm`:
  - Carga clips en memoria.
  - Concat de video pista 1.
  - Mix de audio (voz + música) con `-filter_complex amix`.
  - Output blob → descarga directa.
- Warning si total >2 min o algún clip es 4K: "ffmpeg.wasm puede ser lento o fallar; te sugerimos bajar la resolución".

> **Si el tiempo aprieta:** entregar solo "concat de videos" sin pistas de audio; mover el mix a una iteración posterior.

### 3. Dubbing pipeline (1.5h)

UI en preview de cualquier video completado: botón "Doblar a otro idioma".
- Modal: selector de idioma destino (en, es, pt, fr, de, it, ja, zh).
- Costo = duración del video × tarifa dubbing (60s = 800 créditos).
- Confirma → server action submit con `provider='elevenlabs'`, `model='dubbing'`, `params={source_video_url, target_lang}`.
- Worker: POST a `/v1/dubbing`, polling de `dubbing_id`, descarga del video doblado, sube a Storage.
- Nueva fila en `generations` con `parent_generation_id = original_video_id`.

### 4. Plantillas comunitarias (1h)

- `/app/presets/page.tsx`:
  - Tabs: "Mis presets" / "Comunidad".
  - Comunidad: grid de presets con `is_public=true`, ordenados por `uses_count desc`.
  - Cada card: nombre, descripción, tipo (image/video/audio), creador (avatar), uses count.
  - Botón "Usar preset" → navega al `/app/create/{type}` con los params pre-cargados.
- Cuando un usuario genera con un preset, incrementar `uses_count` (vía RPC o trigger).
- Botón "Guardar como preset" en cualquier UI de generación: dialog con nombre + descripción + toggle "Hacer público".

### 5. Refinamiento UI (1.5h)

Pasada de polish:
- Skeletons consistentes en todas las páginas (no spinners random).
- Estados vacíos con CTAs claros (no solo "nada por aquí").
- Toast notifications para acciones (con `sonner` o equivalente): "Imagen generada", "Créditos ajustados", "Compra aprobada".
- Tooltips en iconos sin label.
- Transitions consistentes (150-250ms).
- Verificar contraste en dark mode (foco en bordes y text-muted).
- Mobile: verificar que la bottom-nav funciona y que las pantallas de creación son usables.

### 6. Seed de demo (1h)

Script `supabase/seed/demo.sql` que un admin corre una sola vez:
- 1 usuario admin (el del demo): perfil completo, avatar, 50K créditos.
- 2 usuarios "fake" miembros del workspace del admin (avatares distintos, para que el switcher se vea con vida).
- 1 workspace "Zyra Demo".
- 2-3 campañas: "Campaña Verano 2026", "Brand Refresh".
- 4-5 proyectos en cada campaña.
- 2 brand kits: uno minimalista (negro/blanco), uno expresivo (violetas y naranjas).
- 1 cast de 3 personajes: con refs precargadas (subir manualmente).
- 6-8 presets públicos cubriendo casos comunes (photo-product, vertical-reel, infografía, narración corporativa).
- 15-20 generaciones de ejemplo (imágenes y videos cortos) cubriendo todos los proveedores. Hacerlas con cuentas reales para que sean believable.
- 1 storyboard completado.
- 2-3 compras simbólicas con estados distintos (pending, approved, rejected).

### 7. Auditoría técnica (1h)

Pasar el checklist:
- [ ] `next build` sin warnings de TypeScript.
- [ ] Lighthouse en `/` (landing) y `/app`: performance >85, accessibility >95.
- [ ] Sin console.errors en flujos principales.
- [ ] Sin URLs de proveedores leaked (todos los `<img src>` y `<video src>` apuntan a `*.supabase.co`).
- [ ] Sin keys en bundle del cliente (revisar `NEXT_PUBLIC_*`).
- [ ] Probar logout y re-login limpia bien el estado.
- [ ] Probar el flujo completo en mobile (iOS Safari + Android Chrome).

### 8. Guion de demo (0.5h)

Crear `docs/demo-guion.md` con:
- 5-7 minutos cronometrados.
- Orden sugerido:
  1. (1 min) Landing → signup express con email → onboarding → vista del dashboard con seed precargado.
  2. (1.5 min) `/app/create/image` con Nano Banana Pro: prompt + brand kit + personaje + generar → mostrar resultado.
  3. (1 min) Smart crop multi-formato del resultado.
  4. (1.5 min) `/app/create/video` con Veo Fast: image-to-video usando la imagen anterior como primer frame.
  5. (1 min) Storyboard mode: tira de 4 frames → generar → animar.
  6. (1 min) `/app/billing` → comprar pack → switch a `/admin/purchases` → aprobar → ver balance subir en vivo.
- Plan B si falla un proveedor: tener videos pre-generados en seed para mostrar en su lugar.

## Criterios de aceptación

- [ ] Cleanup endpoint corre manualmente sin errores; los counts de "antes/después" tienen sentido.
- [ ] Timeline editor exporta un MP4 reproducible para timelines de 30s 1080p.
- [ ] Dubbing produce un video en otro idioma con audio sincronizado.
- [ ] Preset público se puede usar desde otra cuenta y `uses_count` incrementa.
- [ ] Seed demo deja la cuenta del admin con apariencia "ya tiene meses usándola".
- [ ] Lighthouse audit pasa en performance y accessibility.
- [ ] Guion de demo se puede ejecutar en <7 minutos sin "errores en vivo".

## Lo que se queda fuera explícitamente

Cosas que el spec menciona o se podrían querer pero no caben en una semana:

- Email transaccional (Resend/Postmark) — toda notificación es in-app.
- Webhooks de proveedores — polling siempre.
- Stripe / pasarela real — compras simbólicas con aprobación admin.
- Sentry / Axiom — logs nativos de Vercel.
- i18n del UI — todo español.
- Tests automatizados (unit/E2E) — solo smoke tests manuales por fase.
- Multi-workspace avanzado (invitar miembros via email) — el owner se inserta solo, no hay invite flow.
- Voice library completa de ElevenLabs — selector simplificado.
- A11y exhaustivo — solo lo que pase Lighthouse.

## Buffer y contingencia

Día 7 también es buffer: si fases 3 o 4 quedaron debiendo, recortar de polish antes que de funcionalidad. Orden de sacrificio si no alcanza el tiempo:

1. Lighthouse auditing (skippeable).
2. Dubbing (feature menos crítica).
3. Plantillas comunitarias (puede ser un seed estático).
4. Timeline editor (reducir a "solo concat de videos").
5. Refinamiento UI (lo mínimo viable está OK).

Nunca sacrificar: seed de demo y guion (sin esto la presentación no funciona).

## Cierre

Al terminar el día 7:
- Confirmar que el dominio Vercel responde sin errores.
- Hacer un signup desde una cuenta nueva (no admin) para probar el flujo cold-start.
- Verificar quota de QStash y Supabase egress: deben tener margen para varias horas de demo.
- Tag git `v1.0-demo` y backup de la DB de Supabase.
