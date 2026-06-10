# Fase E — Entrega, reporte de valor y polish

> **~2 días · ~15 horas**
>
> Cierra el pipeline: calendario y export, reporte de valor con rate card propia, pack de
> imágenes, retención de drafts y polish para la demo. Fuente: doc V2 §4.1 (etapas 4-5) y §6.

## Pre-requisitos

- Fases A–D cerradas.
- Decisión vigente: **sin publicación a plataformas de ads** — solo calendario + export.

## Objetivo

Al cerrar la fase, una campaña terminada entrega: calendario visual, export CSV/XLSX listo
para un media buyer, pack de imágenes complementario y un reporte de valor que materializa
el argumento de la presentación (costo y tiempo vs producción tradicional).

## Tareas en orden

### 1. Calendario de campaña (2.5h)

- Vista mensual en `app/app/campaigns/[id]/calendar`: items finales por `scheduled_date`,
  color por formato, drag para reprogramar (actualiza `scheduled_date`).
- Solo lectura para items no finalizados (placeholder gris).

### 2. Export (2h)

- `exportCampaign(campaignId, format: 'csv' | 'xlsx')` server action:
  columnas fecha · formato · archivo (URL firmada de Storage con expiración) · duración ·
  ratio · caption · objetivo · notas.
- Generación server-side (csv nativo; xlsx con lib ligera — justificar peso o quedarse en
  CSV si excede; estamos en Hobby).

### 3. Rate card propia + admin (2.5h)

- Migración `025_rate_card.sql`: tabla `value_rate_card (id, asset_type, label, low_usd,
  mid_usd, high_usd, active)` con seed propio de valores iniciales razonables por tipo
  (video UGC, demostración, unboxing, hero CGI, spot cinematográfico, FOOH, foto producto,
  banner). **Valores propios, no copiados de terceros** (decisión doc V2 §7.6).
- Pantalla `/admin/rate-card`: tabla editable (patrón de `/admin/pricing` existente).

### 4. Reporte de valor (4h)

`app/app/campaigns/[id]/report` (visible al cerrar la campaña):

- **Costo real**: suma de `credit_transactions` de la campaña (consumos confirmados, drafts
  incluidos) → conversión a USD por el costo del pack (datos V1).
- **Costo tradicional**: items finales × rate card (rango low–mid–high por tipo de activo).
- **Tiempo**: horas de render reales (timestamps de jobs) vs semanas estimadas tradicionales.
- Render: hero card con ahorro % y tiempo, tabla de desglose por formato, barras comparativas
  en CSS puro (sin libs de charts), footer de metodología ("estimaciones de industria,
  editable en admin; no es una cotización").
- Sin emojis; estética del sistema (zinc-950 + `#7c3aed`).

### 5. Pack de imágenes de campaña (2.5h)

Generación complementaria al cierre (compuerta única, doc V2 §4.5):

- Mix propuesto: posts 1:1 derivados de las escenas ganadoras, banners 16:9, stills de
  producto con y sin personas — generados con **FLUX** (desde cero, compilers de Fase B) y
  refinados con **Nano Banana** (edición: insertar logo, ajustar fondo).
- Volumen proporcional al de la campaña (ej. 1 imagen por cada 3-5 videos, techo demo).
- Los banners con copy exacto quedan marcados "texto en post" mientras no haya modelo
  especialista (decisión doc V2 §7.1) — el caption va en el export, no quemado en la imagen.

### 6. Retención y límites (1.5h)

- Extender `/api/jobs/cleanup` (schedule diario existente): purgar outputs draft de items
  que ya tienen final aprobado (>7 días), y drafts huérfanos de campañas archivadas.
- Verificar presión de Storage con campañas de 30 items (límites free, doc V2 §5.5).

### 7. Polish demo (2h)

- Estados vacíos con CTA en todas las vistas nuevas (campañas, plan, calendario, reporte).
- Loading/skeleton consistentes; revisar mobile (bottom-nav incluye Campañas).
- Recorrido de demo ensayable: brief → plan → muestra → lote → destilar → serie → reporte.
- Sin emojis en UI; revisar copy en español.

## Criterio de cierre

- Demo end-to-end completa con una campaña real de ~10 items (smoke del usuario).
- Export abre bien en Excel/Sheets; URLs firmadas funcionan y expiran.
- Reporte de valor con números reales de la campaña de prueba.
- `pnpm typecheck`, tests y `pnpm build` verdes.
