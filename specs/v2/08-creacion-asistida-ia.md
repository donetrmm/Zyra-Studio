# Fase H — Creación asistida por IA (Brand Kit y Cast)

> **~1.5 días · ~10.5 horas**
>
> Un wizard guiado que crea personajes (Cast) y prepara productos (Brand Kit) con ayuda de IA:
> Gemini Flash aclara lo que falta, FLUX genera al personaje ficticio, Nano Banana edita y
> mejora. Reusa el pipeline de generación, créditos y RLS existentes — no toca la base de datos.
> Fuente de verdad: doc V2 §4.4 (Brand Kit y Cast). Diseño validado el 2026-06-13.

## Decisiones fijadas (no rediseñar sin confirmar)

- **El producto real se respeta.** La IA NUNCA inventa el empaque/logo de un producto de marca.
  Para producto, la IA solo: (a) auto-detecta el brief (reusa `analyzeProductBrief`) y (b)
  **mejora opcional** de la foto subida (quitar fondo, mejorar luz) con Nano Banana, solo si el
  usuario lo pide. La generación desde cero con FLUX es **solo para personajes** (ficticios).
  > **Corrección 2026-06-13 (implementación Plan 2):** se descartó la acción "generar ángulo"
  > que listaba este spec — generar una cara no vista del producto **fabrica geometría** y choca
  > con la regla dura de no inventar atributos. Las mejoras solo ajustan fondo/luz manteniendo el
  > producto idéntico.
- **Flujo = wizard guiado con aclaración IA**, no chat libre. Pasos cortos y predecibles; Gemini
  hace 1-2 preguntas concretas antes de generar, en **una sola ronda**.
- **Estado efímero en cliente** (Enfoque A). Nada nuevo en la base; solo persiste al Guardar.
  Las imágenes generadas ya quedan como `media_references` (necesario para usarlas).
- **Cobertura: ambos** (Cast modo `character` + Brand Kit modo `product`), motor compartido.

## Pre-requisitos

- `lib/cast/describe-character.ts` existe (Fase A §3, nota 2026-06-13) — el wizard lo reusa.
- `analyzeProductBrief` (`lib/campaigns/brief.ts`) y el provider Nano Banana
  (`lib/providers/nano-banana.ts`, multi-turn con `thoughtSignature`) funcionando.
- Pipeline de generación suelta operativo: `submitGenerationAction`,
  `addGenerationAsReferenceAction`, realtime de status, reserva/confirmación de créditos.

## Objetivo

Al cerrar la fase, desde el Cast y desde el Brand Kit, el usuario puede abrir un wizard,
describir lo que quiere (con o sin referencia), responder 0-2 preguntas de aclaración, generar
una imagen, iterar ediciones y guardar — un personaje listo en el Cast o un producto preparado
en el Brand Kit, en una sola sesión guiada.

## Estructura

```
lib/creation/
  clarify.ts          ← Gemini Flash: aclaración (preguntas + enrichedPrompt). server-only.
lib/schemas/
  creation.ts         ← zod del contrato de clarify y del payload del wizard.
server-actions/
  creation.ts         ← clarifyCreationAction(): valida + llama a clarify.ts.
components/creation/
  CreationWizard.tsx   ← wizard compartido (modal); ramas por kind.
  steps/               ← subcomponentes de paso si crecen (intención, aclaración, preview, editar).
```

Modificados: `components/cast/CastPage.tsx` (botón "Crear con IA"),
`components/brand-kits/BrandKitsPage.tsx` (botón "Crear/Mejorar con IA").

## Contrato (`lib/schemas/creation.ts`)

```ts
type CreationKind = 'character' | 'product';
```

**La aclaración conversacional es solo del modo `character`** (donde el contenido se inventa y
Gemini necesita acotar la apariencia). El modo `product` NO usa `clarify`: su "paso 2" es el
brief auto-detectado por `analyzeProductBrief` (editable), porque el contenido sale de la foto,
no de preguntas.

```ts
// Entrada de la aclaración (solo character).
type ClarifyInput = {
  text: string;            // lo que escribió el usuario (libre, max 1000)
  hasReference: boolean;   // si subió una imagen de referencia
};

// Salida estructurada de Gemini Flash (una sola ronda).
type ClarifyResult = {
  // 0-3 preguntas; vacío = hay suficiente, saltar a generar.
  questions: Array<{ id: string; question: string; suggestions: string[] }>;
  // Prompt de apariencia EN INGLÉS, listo para FLUX. Age-blind, persona
  // ficticia, sin claims (reglas duras aplicadas en el system prompt + stripAgeWords).
  enrichedPrompt: string;
};
```

## Tareas en orden

### 1. `lib/creation/clarify.ts` + `lib/schemas/creation.ts` (2h)

Módulo Gemini Flash **para el modo character** (patrón de `brief.ts`/`format-matcher.ts`: fetch
directo, `responseMimeType` JSON, `thinkingBudget: 0`). System prompt con las reglas duras:

- Describir apariencia, peinado, vestuario y manera de actuar; **age-blind** (sin
  young/old/teen/niño…); persona **ficticia**, nunca un rostro real identificable.
- Pide 0-3 preguntas SOLO si falta algo crítico para generar; si el texto ya basta,
  `questions: []`. Las `suggestions` son chips cortos accionables.

(El modo `product` no pasa por aquí: reusa `analyzeProductBrief`, que ya describe solo lo
visible y tiene prohibido inventar atributos/claims.)

Saneo con zod laxo (el LLM es estocástico): un campo malformado no tira el resultado. Aplicar
`stripAgeWords` (de `lib/prompt-director/inventory`) sobre `enrichedPrompt` como red de
seguridad final. Un solo reintento ante `retryable` (como el matcher).

### 2. `server-actions/creation.ts` — `clarifyCreationAction` (1h)

`clarifyCreationAction(input: unknown): Promise<Result<ClarifyResult>>`. Valida con el schema,
`requireWorkspace()`, llama a `clarify.ts`. Falla blanda: si Gemini falla, devuelve
`{ questions: [], enrichedPrompt: <text saneado> }` para que el wizard genere best-effort con
el texto crudo (no bloquea el flujo).

### 3. `components/creation/CreationWizard.tsx` (4h)

Modal/panel client-side con estado efímero (respuestas + versiones en memoria). Props:
`{ kind, referenceContext?, onSaved, onClose }`. Cuatro pasos:

1. **Intención:** `kind` pre-seleccionado; textarea libre; uploader de referencia opcional
   (reusa `ReferenceImagesUploader`). Botón "Continuar".
2. **Aclaración (character) / Brief (product):**
   - *character:* llama `clarifyCreationAction`; renderiza cada pregunta como chips
     (`suggestions`) + input libre. Si `questions: []`, salta directo a generar. Compone el
     prompt final a partir de `enrichedPrompt` + respuestas.
   - *product:* corre `analyzeProductBrief` sobre la foto subida y muestra el brief detectado
     (nombre, paleta, `visualDetails`) editable. Sin preguntas conversacionales.
3. **Generación / preview:**
   - **Nota: para imágenes `submitGenerationAction` es síncrono** — FLUX y Nano Banana se
     ejecutan inline en la action (<60s) y vuelve con la generación ya en `done` (solo el video
     va por QStash). No hace falta realtime ni polling.
   - *character:* `submitGenerationAction` (FLUX) con el prompt envuelto en el scaffold de
     retrato neutro (reusar `buildMasterPrompt` de `CastPage`) y la referencia como image-ref;
     al volver `ok`, `addGenerationAsReferenceAction(generationId)` copia el output al bucket de
     referencias y devuelve `{ id, previewUrl }` — `id` es el `media_reference` que se muestra
     y se guarda.
   - *product:* si no se pide mejora, no se genera (foto tal cual). Si se pide → paso 4 (editar).
4. **Editar / Guardar:**
   - *Editar:* prompt de cambio → `submitGenerationAction` con `provider: 'nano-banana'`,
     `conversational: true` y `parentGenerationId` = el `generationId` de la versión actual
     (multi-turn; un cambio por iteración — el server reconstruye el turn previo con su
     `thought_signature`). Cada salida es una **versión** navegable (◀ ▶); su `media_reference`
     se obtiene igual con `addGenerationAsReferenceAction`.
   - *product* expone acciones rápidas: **quitar fondo** (`noBackground`) y **mejorar luz**,
     además del prompt libre. (Sin "generar ángulo": fabricaría una cara no vista del producto.)
   - *Guardar:* ver tarea 4/5.

La UI muestra el **costo en créditos por acción** (FLUX/Nano Banana) antes de ejecutarla
(patrón `fluxCost` ya existente). La aclaración (Gemini Flash) no cobra créditos.

### 4. Integración Cast — modo `character` (1h)

En `CastPage.tsx`, botón "Crear con IA" abre el wizard en modo `character`. Absorbe el actual
"Generar con IA" (que generaba solo desde texto). Al Guardar:

- `createCharacterAction` con la imagen elegida como `masterImageId`.
- La `description` se obtiene corriendo `describeCharacterImage` **sobre la imagen final**
  generada → la descripción matchea exactamente lo que se ve (no el prompt de entrada).

### 5. Integración Brand Kit — modo `product` (1.5h)

En `BrandKitsPage.tsx`, botón "Crear/Mejorar con IA" abre el wizard en modo `product`. Al Guardar:

- Las imágenes elegidas (subida y/o mejoradas) se añaden a `product_image_ids` vía
  `setBrandKitImagesAction`.
- El brief detectado (`analyzeProductBrief` sobre la foto final) prellena nombre/paleta del kit.

### 6. Tests (1h)

Unit con fixtures, **sin APIs reales** (regla del repo):

- `clarify.ts`: parseo/saneo de respuestas (fences markdown, campos faltantes, no-string),
  `stripAgeWords` aplicado sobre `enrichedPrompt`, fallback best-effort.
- schemas zod de `creation.ts`.
- Lógica pura de composición del prompt final (enrichedPrompt + respuestas).

Smoke manual (usuario): crear un personaje y mejorar un producto end-to-end con créditos reales.

## Errores y guardas

- Aclaración Gemini falla → generar con el texto crudo (best-effort, como el matcher).
- Safety reject de FLUX/Nano Banana → mensaje claro, permitir reescribir el prompt.
- Créditos insuficientes → mensaje, no encola.
- Cerrar el wizard a medias → las imágenes generadas quedan en la librería; el personaje/kit
  NO se crea hasta Guardar.
- Rostros reales (personaje): aviso visible "sin rostros de personas reales" (los bloquea
  Seedance anti-deepfake); el scaffold pide *fictional person*. `stripAgeWords`/`findClaims`
  como red de seguridad sobre lo que devuelva Gemini.

## Criterio de cierre

- `pnpm typecheck` y tests verdes.
- Desde el Cast: describir → (aclarar) → generar (FLUX) → editar (Nano Banana) → Guardar crea un
  personaje con `master_image_id` y `description` derivada de la imagen final.
- Desde el Brand Kit: subir foto → mejorar opcional (Nano Banana) → Guardar añade la imagen a
  `product_image_ids` y prellena el brief; sin mejora, la foto se usa tal cual.
- Revisión manual: ningún flujo permite inventar el empaque/logo de un producto real ni un
  rostro real identificable.
