# V2 — Refinado conversacional de creativos

> Spec producido por brainstorming el 2026-06-11. Decisiones del usuario:
> solo campañas (nivel item) · la conversación produce el item completo ·
> costo fijo por sesión cobrado al aceptar · un solo modo (conversación
> estructurada con etapas visibles) · diccionario de tomas con imágenes
> pre-generadas · página dedicada · format matcher compartido entre wizard
> y refinado (las ideas que no encajan generan formato custom).

## Problema

La parte de campañas es difícil de entender sin explicación. El usuario que
no es director creativo no sabe escribir un buen `scene_prompt`, no sabe qué
toma pedir, no sabe que ciertos sujetos (manos, texto, identidad, producto
fiel) necesitan referencias, y descubre las limitantes del modelo después de
pagar la generación. El conocimiento experto existe en el sistema
(`lib/prompt-director/`) pero no conversa con el usuario.

## Solución

Un modo de **refinado conversacional**: el usuario describe lo que quiere en
sus palabras, el sistema hace preguntas de aclaración (pocas, con chips
clicables), advierte limitantes en el momento, verifica referencias y toma, y
al final el creativo queda completo y listo para producir. La conversación es
guiada por etapas visibles — guía y chat son la misma cosa.

## Flujo de usuario

**Entrada**: botón "Refinar" en cada creativo editable del plan
(`planned | skipped | failed`), y "Agregar creativo" lleva a la misma página
en modo nuevo. El diálogo actual de agregar item se retira (una sola forma de
crear, no dos).

**Página** `/app/campaigns/[id]/refine/[itemId]` y `/refine/new`:
- Izquierda: chat con stepper de 4 etapas.
- Derecha: el creativo armándose en vivo (escena, toma, persona, referencias,
  advertencias, costo del creativo).
- Header: "← Volver al plan · Refinar creativo · <formato> · −N cr al aceptar".

**Las 4 etapas** (el LLM hace máximo 2-3 aclaraciones por etapa):

1. **Qué mostrar** — "¿Qué momento del producto quieres mostrar?" Respuesta
   libre o chips sugeridos según formato y brief.
2. **Toma** — propone 2-3 tomas del catálogo según formato y escena, como
   cards con imagen real; "ver todas" abre el diccionario completo. Si el
   usuario ya describió la toma en la etapa 1, aquí solo se confirma.
3. **Referencias** — verifica lo que el formato exige (`required_refs`) y
   detecta sujetos difíciles de generar → pide subir (uploader compartido) o
   elegir del Brand Kit/Cast. Se puede continuar sin referencias, con
   advertencia explícita de que afecta el resultado.
4. **Revisión** — borrador final + advertencias del validador en lenguaje
   claro + costo de sesión y de generación. "Aceptar y guardar" cobra y
   persiste; "Descartar" no cuesta nada.

Las advertencias del validador aparecen **en cada turno**, no solo al final:
el usuario aprende mientras decide.

**Al aceptar** → vuelve al plan con el item actualizado (`status='planned'`).

## Format matcher (compartido)

`lib/prompt-director/format-matcher.ts`: recibe texto libre + formatos del
workspace → Gemini con salida JSON validada por zod → por cada idea:
`{ formatId }` (encaja en un formato existente) o
`{ customFormat: { name, register, cameraStyle, pacing, requiredRefs } }`
(no encaja → se propone formato custom, `is_system=false`, del workspace,
visible en `/app/formats`).

Lo consumen:
- **Wizard de campaña**: textarea opcional "Describe lo que imaginas". Las
  ideas del usuario siembran el mix del plan; lo que no encaja genera formato
  custom. Sin texto, el mix se propone como hoy.
- **Refinado**: si la conversación se sale del catálogo de formatos, el
  matcher propone el formato custom inline y el usuario lo confirma.

## Diccionario de tomas

`lib/shots/catalog.ts` — módulo estático, ~14 tomas:

```ts
type Shot = {
  slug: string;            // 'close-up', 'cenital', 'dolly-in', …
  name: string;            // nombre en español
  description: string;     // una línea: qué es
  whenToUse: string;       // una línea: cuándo conviene
  motion: boolean;         // toma con movimiento de cámara
  formats: string[];       // slugs de formatos afines
  image: string;           // /shots/<slug>.jpg
};
```

- Imágenes pre-generadas **una sola vez** con FLUX vía
  `scripts/generate-shot-images.ts` (lo corre el usuario con API real, como
  los smoke tests; los subagentes y tests nunca llaman APIs reales).
  Versionadas en `public/shots/`.
- Para tomas con movimiento: imagen + flecha de trayectoria sobrepuesta.
- El diccionario se consulta desde la etapa de Toma y queda navegable como
  sección expandible de la página de refinado.

## Arquitectura

```
[RefineView (client)]  página dedicada: chat + stepper + borrador vivo
        │  estado de conversación e historial viven en el cliente
        ▼
server-actions/refine.ts
  refineItemTurnAction   zod (historial ≤10 turnos) + ownership →
        │                contexto server-side (formato, brief, Brand Kit,
        │                Cast) → Gemini structured output →
        │                { respuesta, etapa, chips, draftPatch, validación }
        │                validador de producibilidad corre en cada turno
        │                (lib/prompt-director/validators). NO cobra.
        ▼
  acceptRefinedItemAction  re-valida el borrador completo server-side →
                           cobra sesión (funciones SQL atómicas, precio en
                           model_pricing) → persiste campaign_items (escena,
                           shot, character_id, refs, warnings, status
                           'planned') → crea formato custom si aplica →
                           revalidatePath del plan
```

- Cada turno de Gemini Flash tarda segundos → server action directa, sin
  cola (regla del repo: worker solo para >50s).
- Si el usuario cierra la página, no se persiste ni cobra nada.
- Al llegar a 10 turnos, el sistema fuerza la etapa de Revisión.

## Datos

Migración aditiva `030_refine.sql` (no toca migraciones aplicadas):

```sql
alter table campaign_items add column if not exists shot text;
```

- La toma queda estructurada — las plantillas vivas y los compilers la
  consumen sin parsear el prompt.
- Precio de sesión: fila nueva en `model_pricing` (slug `refine-session`),
  editable desde el panel admin como el enhance.

## Cobro

- Costo fijo por sesión, anunciado en el header desde el primer turno.
- Se cobra **una sola vez, al aceptar**, vía `reserve_credits` →
  `confirm_credits`. Descartar o abandonar no cuesta.
- El costo de Gemini de sesiones abandonadas se absorbe (ruido a escala demo).

## Errores

| Caso | Comportamiento |
|---|---|
| Gemini falla un turno | Botón de reintento visible; el historial no se pierde (vive en el cliente) |
| Borrador incompleto al aceptar | `validation_error` con el campo faltante; el server re-valida siempre |
| Item ya no editable (otro tab lo encoló) | `forbidden`/`not_found` y regreso al plan |
| Créditos insuficientes al aceptar | Toast estándar de créditos con CTA |
| 10 turnos alcanzados | Transición forzada a Revisión |

## Testing (sin APIs reales)

- `format-matcher`: fixtures de respuestas Gemini → match correcto, custom
  propuesto, JSON malformado rechazado por zod.
- `refine` actions: parche aplica sobre el borrador; validador dispara
  advertencias esperadas (3+ sujetos, texto en pantalla, identidad sin
  referencia); accept rechaza borradores incompletos; cobra exactamente una
  vez (mock de las funciones de créditos).
- `lib/shots/catalog`: cada toma referencia formatos existentes; imágenes
  declaradas existen en `public/shots/`.
- Smoke con API real (Gemini + generación de imágenes del diccionario): lo
  corre el usuario.

## Fuera de alcance

- Persistir sesiones de conversación (retomarlas entre dispositivos).
- Refinado en Creación rápida (el matcher y el catálogo quedan reutilizables
  si se decide después).
- Video-ejemplos en el diccionario de tomas.
- Que las respuestas del usuario ajusten el brief de la campaña (aprendizaje
  cross-item).

## Orden de implementación sugerido

1. `lib/shots/catalog.ts` + script de generación de imágenes + migración 030.
2. `format-matcher` con tests por fixtures.
3. Actions de refine (turno + accept) con tests.
4. Página de refinado (chat, stepper, borrador vivo, diccionario).
5. Integración: botón en el plan, retiro del diálogo de agregar, textarea del
   wizard → matcher → plan sembrado.
