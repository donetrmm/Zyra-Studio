# Pulido estético/UX de 1to1 Studio — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Ejecuta tarea por tarea. Estas son correcciones de UI derivadas de la auditoría estética/UX (3 lentes), `aesthetic-ux-review`. No hay tests unitarios para la mayoría (UI presentacional); los gates son `pnpm typecheck` + `pnpm lint` + `pnpm build` y la revisión por tarea.

**Goal:** Cerrar los hallazgos P1–P3 de la auditoría estética/UX: unificar el azul de marca, escala tipográfica, consistencia del design system, teclado/a11y, arquitectura del Studio, "wow" en el interior y auth, y cierres (nav móvil, doc de marca).

**Architecture:** Cambios fundacionales primero (tokens de color y tipografía en `app/globals.css`), luego consumidores. Reusar tokens y componentes shadcn; nada de estilos ad-hoc nuevos.

**Tech Stack:** Next.js 16, Tailwind v4 (`@theme`), shadcn/radix, oklch tokens.

## Global Constraints

- **Marca:** dark mode por defecto; `--primary` `oklch(0.55 0.20 256)` (≈#0072e6) = rellenos con texto blanco; **nuevo** `--brand: #009fff` = acentos/texto/iconos sobre fondo oscuro. SIN emojis en la UI. shadcn primero; no reinventar componentes que ya existen.
- **No `any`** en TS. `pnpm` (`pnpm typecheck`, `pnpm lint`, `pnpm build`).
- Commits **sin** `Co-Authored-By`. Estilo `fix(ux)/feat(ux): ...` en español.
- No cambiar comportamiento de negocio (créditos, generación, RLS) — esto es solo presentación/UX.
- Cada tarea: typecheck + lint + build verdes antes de commit. El build es el único gate del gotcha `'use server'`.

---

### Task 1: Sistema de color — token de marca y unificación de los dos azules (P1 + P2)

**Files:**
- Modify: `app/globals.css` (definir `--brand` + exponer utilidad)
- Modify: `components/campaigns/CampaignStudioView.tsx` (sweep `sky-*` → brand)
- Modify: `components/campaigns/CampaignCalendar.tsx` (sweep `sky-*` → brand si el uso es de acento)

**Cambios:**
1. En `app/globals.css`, dentro de `@theme inline` (junto a `--color-primary`), añadir:
   ```css
   --color-brand: var(--brand);
   --color-brand-foreground: var(--brand-foreground);
   ```
   En `:root` y en `.dark` añadir el token (mismo valor en ambos; es el azul eléctrico del logo):
   ```css
   --brand: #009fff;
   --brand-foreground: oklch(0.985 0 0);
   ```
2. En `CampaignStudioView.tsx`, reemplazar los acentos `text-sky-400 / text-sky-300 / bg-sky-*/border-sky-*` que comunican estados live/final/acción (evidencia auditoría: `:95-100, :535, :1300-1320`) por el token de marca: `text-brand`, `bg-brand/10`, `border-brand/40`, etc. Mantener la MISMA intensidad relativa (usar opacidades `/10 /20 /40`). No tocar rojos/ámbar/verde de estado.
3. En `CampaignCalendar.tsx`, revisar los `sky-*`: si son acento de marca, migrar a `brand`; si son una categoría cromática distinta intencional, dejarlos y anotarlo en el reporte.

**Verificación:** `pnpm typecheck && pnpm lint && pnpm build`. Confirmar por grep que no quedan `sky-` de acento en `CampaignStudioView.tsx`.

**Commit:** `feat(ux): token de marca #009fff y unificacion de los dos azules en el Studio`

---

### Task 2: Escala tipográfica — tokens + migración de superficies de alto tráfico (P2)

**Files:**
- Modify: `app/globals.css` (tokens de tamaño en `@theme`)
- Modify: superficies de alto tráfico: `components/layout/*` (Sidebar, Topbar, MobileBottomNav), `app/app/page.tsx`, `components/campaigns/CampaignStudioView.tsx`, `components/campaigns/CampaignStudioWizard.tsx`

**Decisión de alcance (deliberada, flageada):** NO migrar los ~578 tamaños arbitrarios a ciegas — el medio-píxel es ajuste fino intencional del look denso premium y un sweep total arriesga regresiones visuales. Se INTRODUCE la escala y se migra solo el shell + dashboard + Studio + wizard (las superficies que la auditoría citó). El resto queda para incremental.

**Cambios:**
1. En `app/globals.css` `@theme inline`, añadir tokens (mapeados a los tamaños reales más usados):
   ```css
   --text-2xs: 0.6875rem;   /* 11px */
   --text-2xs--line-height: 1rem;
   --text-xs: 0.75rem;      /* 12px */
   --text-xs--line-height: 1.1rem;
   --text-sm: 0.8125rem;    /* 13px */
   --text-sm--line-height: 1.25rem;
   --text-base: 0.875rem;   /* 14px */
   --text-base--line-height: 1.4rem;
   ```
   (Esto hace que `text-2xs/text-xs/text-sm/text-base` rindan los tamaños del sistema. Verifica que no rompan utilidades existentes de Tailwind: si `text-xs/text-sm/text-base` ya existen con otros valores, estos overrides los redefinen al tamaño del proyecto — confírmalo en build.)
2. En las superficies listadas, reemplazar los `text-[11px]/text-[11.5px]` → `text-2xs`, `text-[12px]/text-[12.5px]` → `text-xs`, `text-[13px]` → `text-sm`, `text-[14px]` → `text-base`. Redondear los medio-píxeles al token más cercano. NO tocar tamaños grandes de heading (déjalos como están).

**Verificación:** `pnpm typecheck && pnpm lint && pnpm build`. Revisar visualmente que el shell/dashboard/Studio no cambian de densidad de forma brusca (los tokens igualan los valores actuales).

**Commit:** `feat(ux): escala tipografica con tokens y migracion del shell/Studio`

---

### Task 3: Design system — hover del Button, botones a mano → shadcn, focus-ring consistente (P2 + P3 + quick win)

**Files:**
- Modify: `components/ui/button.tsx` (hover)
- Modify: `components/campaigns/CampaignStudioView.tsx` (botones a mano → `<Button>`)
- Modify: `app/globals.css` (utilidad de focus-ring, opcional) o aplicar la clase de foco directamente en los interactivos custom

**Cambios:**
1. `components/ui/button.tsx`: el variant primario hoy hace `[a]:hover:bg-primary/80` (solo aplica a `<a>`). Cambiar a `hover:bg-primary/90` para que el `<button>` también tenga hover. Revisar que no rompa otros variants.
2. `CampaignStudioView.tsx`: los botones construidos a mano (`inline-flex … rounded-lg border …`, evidencia `:271-276, :535, :1308-1320`) reemplazarlos por `<Button variant="outline|ghost" size="sm">` heredando focus/disabled/hover. Mantener iconos/labels.
3. Foco visible consistente: en los interactivos custom que caen al outline del navegador (tabs/toggles/`SectionTabs`), aplicar `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background`. (Task 4 también toca tabs — coordina: aquí solo el estilo de foco, allá el teclado.)

**Verificación:** `pnpm typecheck && pnpm lint && pnpm build`. Confirmar que el CTA primario tiene hover y que los botones del Studio heredan estados.

**Commit:** `fix(ux): hover del Button, botones del Studio a shadcn y foco visible consistente`

---

### Task 4: Teclado/a11y en tablists + rename de label (P2 + P3)

**Files:**
- Modify: `components/campaigns/CampaignStudioView.tsx` (tabs del Studio)
- Modify: el componente `SectionTabs` (buscar su archivo: `components/**/SectionTabs.tsx`)
- Modify: `components/campaigns/CampaignStudioWizard.tsx` (rename label)

**Cambios:**
1. Tablists con `role=tablist/tab/aria-selected` (evidencia `CampaignStudioView.tsx:303-327`, `SectionTabs.tsx:11-33`) hoy no responden a teclado. Implementar el patrón ARIA tabs: roving `tabIndex` (la pestaña activa `0`, las demás `-1`) + `onKeyDown` con `ArrowLeft/ArrowRight/Home/End` que mueva el foco y la selección. Si es más limpio, reemplazar por el componente `Tabs` de shadcn/radix (que ya trae el patrón) — elige lo que menos rompa el layout actual.
2. `CampaignStudioWizard.tsx:523-542`: el label "Texto sugerido para publicar" está sobre un Select cuyas opciones son objetivos (conozcan/compren) pero solo ajusta el CTA del caption. Renombrar el label a **"Objetivo del texto (caption)"**.

**Verificación:** `pnpm typecheck && pnpm lint && pnpm build`. Verificar que las flechas mueven entre pestañas y el foco es visible.

**Commit:** `fix(a11y): navegacion por teclado en tablists del Studio + label de objetivo`

---

### Task 5: Arquitectura del Studio — promover Storyboard + disclosure del wizard (P2)

**Files:**
- Modify: `components/campaigns/CampaignStudioView.tsx` (header de acciones)
- Modify: `components/campaigns/CampaignStudioWizard.tsx` (disclosure de opciones avanzadas)

**Cambios:**
1. En el header del Studio (evidencia `CampaignStudioView.tsx:270-328`), CSV/Storyboard/Reporte/Settings comparten el mismo estilo ghost en una fila. **Storyboard** es un modo de autoría, no una utilidad: promoverlo a entrada de primer nivel diferenciada (p.ej. botón con acento de marca o separado del grupo de utilidades), y dejar CSV/Reporte/Settings como utilidades (iconos o un overflow "Más"). No cambiar la funcionalidad, solo la jerarquía visual.
2. En `CampaignStudioWizard.tsx` (evidencia `:281-626`), el formulario es un scroll de ~9 secciones antes del único CTA. Mantener visibles **Producto, Nombre, Ideas, Personajes, Formato**; colapsar **URL, Texto (objetivo/caption), Idioma, Música** bajo un disclosure "Opciones avanzadas (opcional)" (un `<details>`/`<summary>` accesible o un toggle con estado). Estado por defecto: colapsado. No quitar ningún campo ni cambiar el submit.

**Verificación:** `pnpm typecheck && pnpm lint && pnpm build`. Confirmar que el wizard sigue enviando todos los campos (colapsados incluidos) y que Storyboard sigue accesible.

**Commit:** `feat(ux): promover Storyboard y colapsar opciones avanzadas del wizard`

---

### Task 6: "Wow" en el interior + auth + gradiente del hero (P2 + P3)

**Files:**
- Modify: `app/app/page.tsx` (dashboard hero / tarjeta de créditos)
- Modify: `components/ui/page-empty-state.tsx` (acento de marca en el icono)
- Modify: `app/(auth)/layout.tsx` y el componente `AuthCard` (logo + glow + valor)
- Modify: `app/onboarding` layout/fondo si comparte el lienzo plano
- Modify: `app/landing.css` (`gradient-text` real)

**Cambios (un solo "momento de marca" por pantalla, sutil — no recargar):**
1. Dashboard (`app/app/page.tsx:132-147,157`): añadir un glow radial sutil del acento `#009fff` (4–6% de opacidad) detrás del `CampaignHero`/tarjeta de créditos, reusando el lenguaje de la landing. Sin saturar.
2. `page-empty-state.tsx:26`: dar al icono del estado vacío un acento de marca (`text-brand` o un glow tenue) en vez del gris plano.
3. Auth (`app/(auth)/layout.tsx:8-18`, `AuthCard`): reusar `logo.png` real, un glow radial `#009fff` tenue de fondo y una línea de valor ("500 créditos gratis. Sin tarjeta." — confirma el valor real en el código de signup/onboarding antes de hardcodearlo; si difiere, usa el real). Mantener la card centrada.
4. Fondo de auth/onboarding: cambiar el `bg-background` plano por un `radial-gradient` muy tenue del acento (4–6%) + opcional grid/noise muy leve reusando keyframes existentes (`zyra-*`). Sutil.
5. `app/landing.css:221-223`: `gradient-text` hoy pinta un color plano. Aplicar `linear-gradient` real (`#00c6ff → #009fff`) con `background-clip:text; -webkit-background-clip:text; color:transparent;`.

**Verificación:** `pnpm typecheck && pnpm lint && pnpm build`. Sin emojis. Revisar que los glows son sutiles (no degradan legibilidad ni contraste AA).

**Commit:** `feat(ux): firmas de marca en dashboard/empty-states/auth y gradient-text real`

---

### Task 7: Cierres — Guía en nav móvil + actualizar doc de identidad de marca (P2 quick win + P3)

**Files:**
- Modify: `components/layout/MobileBottomNav.tsx` (añadir Guía)
- Modify: `docs/Identidad de Marca.md` (rebrand)

**Cambios:**
1. `MobileBottomNav.tsx:19-30`: "Guía" no está en `MAIN_NAV` ni `MORE_NAV` (en desktop sí, `lib/navigation.ts:55`). Añadir "Guía" al panel "Más" (`MORE_NAV`) del nav móvil, con su icono y ruta reales (cópialos de `lib/navigation.ts`).
2. `docs/Identidad de Marca.md`: el doc contradice la implementación (dice "Zyra Studio", morado `#7B61FF`, Satoshi/Poppins; el código es 1to1 Studio, `#009fff`, Inter/Geist — evidencia `:7,151,157,182`). Actualizar el doc al rebrand real: nombre **1to1 Studio**, acento **#009fff** (y `#0072e6` para superficies con texto blanco por AA), tipografías **Inter + Geist**, paleta base **zinc-950**. Eliminar las referencias al morado para que nadie lo reintroduzca siguiendo el doc obsoleto. (Per regla del repo: el código es la fuente de verdad; alineamos el doc al código.)

**Verificación:** `pnpm typecheck && pnpm lint && pnpm build`. Confirmar que "Guía" aparece en el nav móvil.

**Commit:** `fix(ux): Guia en nav movil y doc de identidad de marca alineado al rebrand`

---

## Verificación final
- `pnpm vitest run` (la suite no debe romperse — estos cambios son de UI), `pnpm typecheck`, `pnpm lint` (0 errores), `pnpm build`.
- Revisión amplia final (un agente) de toda la rama de pulido.
- Smoke del usuario: recorrer login → onboarding → dashboard → crear campaña → Studio, confirmando azul de marca unificado, hover del CTA, Storyboard visible, wizard con opciones avanzadas colapsadas, y los toques de "wow".
