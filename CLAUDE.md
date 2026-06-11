# Zyra Studio — Guía para asistentes de IA

Este archivo se carga automáticamente en cada sesión de Claude Code y orienta a cualquier asistente que trabaje en este repo. Las rules específicas por dominio viven en `.cursor/rules/`.

## Qué es esto

1to1 Studio (antes Zyra Studio) es una plataforma creativa con IA (video, imagen, voz) construida para una presentación. Stack: **Next.js 15 (App Router) + Supabase + Upstash QStash + Vercel Hobby**, todo en plan free. El detalle completo está en `docs/zyra-studio-spec.md` y el plan de ejecución día por día en `specs/01-fundacion.md` … `specs/05-polish-demo.md`.

## Antes de tocar código

1. Si vas a modificar algo no trivial, **lee primero** `docs/zyra-studio-spec.md` (sección relevante) y el archivo de fase correspondiente en `specs/`. La spec es la fuente de verdad.
2. Si una decisión contradice el spec, ese es un bug del código o del spec — flagéalo, no lo "resuelvas" silenciosamente.
3. Identidad de marca en `docs/Identidad de Marca.md` (paleta, tono, slogan). API specifics por modelo en `docs/modelos/`.

## Decisiones arquitectónicas inmutables

Estas no se discuten ni se rediseñan sin pedir confirmación explícita al usuario:

- **Todo lo que tarde >60s pasa por QStash.** Vercel Hobby corta funciones en 60s. Veo, Kling, FLUX y TTS largos son asíncronos por polling re-encolado, sin webhooks.
- **Las URLs de proveedores nunca llegan al cliente.** El worker descarga el output, lo sube a Supabase Storage y solo devuelve URLs internas (`*.supabase.co`).
- **Créditos siempre vía funciones SQL atómicas** (`reserve_credits`, `confirm_credits`, `refund_credits`, `approve_purchase`, `admin_grant_credits`). Nunca actualizar `credit_balances` o `credit_transactions` directamente desde server actions.
- **RLS es la última línea de defensa, no la primera.** Server actions validan con zod + verifican ownership; RLS está ahí para que un bug no se convierta en breach.
- **Service role solo en server-side.** Nunca importes `lib/supabase/admin.ts` desde un componente cliente o un módulo que pueda llegar al bundle.

## Convenciones rápidas

- **No emojis en código ni UI** (sí en commits internos si quieres). El sistema visual es minimalista premium.
- **Dark mode por defecto**, paleta zinc-950 base + acento `#009fff` (azul del logo 1to1; `#0072e6` cuando el fondo lleva texto blanco, por contraste AA).
- **Componentes shadcn primero**; solo escribir desde cero cuando no exista.
- **Server Components por default**, `'use client'` solo si hay state/effects.
- **Server Actions para toda mutación**, validación con zod schema en `lib/schemas/`.
- **Realtime para status updates desde el cliente**, no polling.

## Cómo navegar el repo

```
app/                      ← rutas Next.js
  app/                    ← shell autenticado (sidebar, topbar)
  admin/                  ← panel admin (middleware verifica role)
  api/jobs/process        ← worker QStash (único endpoint backend de generación)
  api/jobs/cleanup        ← schedule diario QStash
components/
  ui/                     ← shadcn
  generation/             ← formularios de creación
  library/                ← cards y grids
  admin/                  ← tablas admin
  layout/                 ← Sidebar, Topbar, MobileBottomNav
lib/
  supabase/               ← client.ts, server.ts, middleware.ts, admin.ts
  providers/              ← veo, kling, nano-banana, flux, elevenlabs adapters
  router/model-selector.ts
  credits/                ← estimator, operations
  jobs/                   ← queue (QStash), worker logic
  prompt-assistant/
  schemas/                ← zod por dominio
server-actions/           ← mutaciones (una por dominio)
supabase/migrations/      ← .sql en orden, NUNCA modificar uno aplicado
docs/                     ← spec, identidad de marca, docs de modelos
specs/                    ← plan de ejecución por fase
```

## Reglas de dominio (lee la que aplique antes de editar)

| Si estás tocando… | Lee primero |
|---|---|
| Migraciones SQL, RLS, triggers | `.cursor/rules/10-database.mdc` |
| Server actions | `.cursor/rules/20-server-actions.mdc` |
| Adapters de proveedor | `.cursor/rules/30-providers.mdc` |
| Worker `/api/jobs/process` | `.cursor/rules/40-worker.mdc` |
| Componentes y páginas | `.cursor/rules/50-ui.mdc` |
| Cualquier cosa con créditos | `.cursor/rules/60-credits.mdc` |
| Cualquier cosa con auth, secrets o RLS | `.cursor/rules/70-security.mdc` |
| Tests unitarios o de integración | `.cursor/rules/80-tests.mdc` |
| Commits o cualquier operación de git | `.cursor/rules/90-commits.mdc` |

## Commits

Los commits de este repo **no llevan `Co-Authored-By: Claude`**. Detalle completo en `.cursor/rules/90-commits.mdc`.

## Cosas que NO hacer

- No agregues dependencias pesadas sin justificarlo (estamos en Vercel Hobby).
- No introduzcas un servicio nuevo (Sentry, Resend, Stripe) sin discutirlo: el alcance es demo, sin email transaccional, sin pasarela real.
- No "limpies" cosas que parecen redundantes pero están documentadas como decisión intencional (ej. `MAX_POLLS` y `timeout_at` cumplen funciones distintas).
- No cambies nombres de tablas, columnas o RLS policies sin actualizar el spec en paralelo.
- No uses `any` en TypeScript. Usa `unknown` + narrowing o un tipo explícito.
- No commitees `.env.local` ni keys.

## Cuando te trabes

- Si una API de proveedor responde algo inesperado, primero revisa el `.md` en `docs/modelos/` correspondiente.
- Si RLS bloquea una query que "debería pasar", el bug suele estar en la policy de INSERT (que también necesita `with check`, no solo `using`).
- Si un trigger no dispara, verifica que la función sea `security definer` y que pertenezca a `postgres`.

## Tono al comunicar cambios

- Reportes cortos, en español, sin pedir disculpas innecesarias.
- Lista lo que cambió y dónde. Si algo quedó pendiente, dilo explícitamente.
- Si encontraste un bug existente mientras hacías otra cosa, no lo arregles silenciosamente — repórtalo y pregunta.
