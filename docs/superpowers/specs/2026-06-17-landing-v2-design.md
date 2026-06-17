# Landing V2 — Diseño

> Brainstorming 2026-06-17. Genera la landing de la V2 ("fábrica de campañas")
> en una ruta nueva sin tocar la landing actual de V1.

## Objetivo

Landing pública que vende **Zyra/1to1 Studio V2** según `ZyraStudioV2/OBJETIVO.md`
y `ARQUITECTURA-Y-CAPACIDADES-V2.md`: no una herramienta de assets sueltos (lo que
vende la landing V1 en `/`), sino un **sistema de producción de campañas** con
calidad de director creativo senior, en lote y con menos iteraciones.

## Decisiones (usuario, 2026-06-17)

1. **Ruta:** `/v2` → `app/v2/page.tsx`. La landing actual en `/` queda intacta.
2. **Mensaje:** reposicionamiento completo a campañas (Campaign Studio).
3. **Visual:** componentes generados con MCP magic pero reajustados a los tokens
   de marca (dark zinc-950 `#09090b`, acento `#009fff` / `#0072e6` sobre texto blanco).

## Stack técnico

- `app/v2/page.tsx` con `"use client"` (animaciones de scroll).
- `app/v2/landing-v2.css`: redeclara los tokens de marca scopeados bajo
  `.landing-v2-page` para no colisionar con `app/landing.css` (`.landing-page`).
- `motion` (framer-motion para React 19 / Next 16), importado desde `motion/react`:
  `whileInView` para reveals al scroll, `stagger` en grids, entrada del hero,
  stepper animado del pipeline.
- No se toca `/`, `landing.css`, ni la app autenticada.

## Secciones

1. **Nav** — estructura premium. Links: Cómo funciona · Formatos · Modelos · Precios.
2. **Hero** — "De un brief a una campaña completa". Calidad senior, menos iteraciones.
   Product shot animado del pipeline (Plan → Muestra → Lote → Entrega).
3. **Cómo funciona** — las 5 etapas del Campaign Studio como stepper animado
   (Brief → Dirección creativa → Producción en lote → Entrega → Aprendizaje).
4. **Formatos** — grilla de los 9 formatos del sistema con micro-descripción
   (Voz Cercana, A Pie de Calle, Manos a la Obra, El Descubrimiento, Antes y Después,
   Susurro, El Ícono, Gran Pantalla, Mundo Imposible).
5. **El oficio encapsulado** (bento) — Prompt Director, Brand Kit + Cast,
   Plantillas vivas, Economía visible (borrador → final).
6. **Modelos** — Seedance 2.0 (video principal, multi-referencia, audio nativo) +
   FLUX/Nano Banana (imagen) + ElevenLabs (voz), enmarcados como producción de campaña.
7. **Valor / economía de iteración** — estimador previo, draft→final, reporte de valor.
8. **CTA final + Footer**.

## Fuera de alcance

- No se inventan claims ni precios nuevos: datos desde la arquitectura V2.
- Sin publicación a plataformas de ads (decisión de arquitectura).
- Sin backend nuevo: es una landing estática con animaciones de cliente.
