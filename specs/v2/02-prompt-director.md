# Fase B — Prompt Director

> **~2 días · ~14 horas**
>
> El oficio encapsulado: convierte `brief + formato + Brand Kit + referencias` en dirección
> de producción optimizada por modelo. Es la capa que sustituye al "diseñador senior".
> Fuente: doc V2 §4.3. Evoluciona `lib/providers/prompt-enhancer.ts` (V1), no lo reemplaza
> de golpe.

## Pre-requisitos

- Fase A cerrada (formatos seedeados, adapter Seedance funcionando).
- `docs/modelos/seedance-2.md` escrito (el compiler se valida contra ese doc).

## Objetivo

Al cerrar la fase, dado un item de campaña (formato + producto + escena + personaje),
`promptDirector.compile(item)` devuelve un prompt de producción listo para el adapter
correspondiente, validado y con las referencias asignadas con propósito explícito.

## Estructura

```
lib/prompt-director/
  index.ts            ← compile(item, context) → CompiledPrompt
  inventory.ts        ← extracción de inventario del brief/Brand Kit
  format-director.ts  ← registro, cámara y ritmo según formato Zyra
  compilers/
    seedance.ts       ← CRAFT + referencias @ + timing
    flux.ts           ← generación de imagen desde cero
    nano-banana.ts    ← edición referenciada (instrucción de cambio + qué preservar)
    veo.ts, kling.ts  ← adaptan las guías existentes de docs/modelos/
  validators.ts       ← producibilidad (pre-encolado)
  antislop.ts         ← lista de términos prohibidos
```

## Tareas en orden

### 1. Tipos y contrato (1h)

```ts
type CompiledPrompt = {
  modelSlug: string
  prompt: string
  params: Record<string, unknown>          // duration, ratio, resolution, audio, seed
  references: Array<{ url: string; role: ReferenceRole; scope?: string }>
  // role: 'product' | 'character' | 'environment' | 'style' | 'camera_motion' | 'audio_rhythm'
  // scope: qué parte usar ("solo rostro y peinado, no la ropa")
  warnings: string[]                        // ajustes que hizo el validador
}
```

### 2. `inventory.ts` (2h)

Extrae del brief + Brand Kit + item: producto (nombre, empaque, colores, detalles visibles),
personaje (descripción física desde el Cast), entorno, estilo/mood.

**Reglas duras (doc V2 §4.3):**
- Nunca inventar atributos de producto o marca que no estén en el Brand Kit.
- Nunca fabricar claims ("clínicamente probado", "10x más rápido") — solo lo visible y audible.
- Personajes sin marcadores de edad; describir por apariencia, vestuario y manera de actuar.

### 3. `format-director.ts` (2h)

Para cada uno de los 9 formatos (desde la tabla `formats`, no hardcodeado): define el esqueleto
de dirección — tipo de plano y movimiento de cámara por defecto, ritmo, registro de voz,
si exige personaje, qué referencias del Brand Kit son obligatorias (`required_refs`),
y settings recomendados de `scene_library` (sugerencia, no restricción).

### 4. `compilers/seedance.ts` (3h)

El compiler principal. Produce el prompt CRAFT (guías Morphic/RunDiffusion):

1. **Referencias primero**, cada @ con propósito y alcance: imagen de producto → fidelidad;
   hoja maestra del Cast → "apariencia exacta de @Image N"; clip de plantilla viva →
   "replica movimiento de cámara y ritmo de @Video 1".
2. **Contexto** (dónde/cuándo/atmósfera) → **Acción** (verbos encadenados, una acción
   principal) → **Encuadre** (términos reales: dolly in, tracking, rack focus) →
   **Timing** (marcadores por segundos si duración > 8 s).
3. Priorización de slots (máx 12 archivos): producto y personaje primero, luego cámara,
   luego audio (tier list de la guía Morphic §8).
4. Audio dirigido: qué se oye y cuándo, no "agrega música".

### 5. `compilers/flux.ts` y `compilers/nano-banana.ts` (2h)

- **flux**: generación desde cero — sujeto + estilo + composición + iluminación (palanca #1)
  + entorno + mood, 80–250 palabras, sin keyword soup.
- **nano-banana**: edición — "cambia [X] a [Y]; mantén todo lo demás igual", **un cambio por
  iteración**; multi-turn conversational para ajustes sucesivos (gotcha conocido del provider:
  chat multi-turn, base64 raw).

### 6. `validators.ts` (2.5h)

Checklist de producibilidad pre-encolado (cada regla evita una regeneración pagada):

- duración 4–15 s y complejidad ∝ duración (1 acción ≈ 4 s; si el scene_prompt tiene >2
  acciones para ≤8 s → warning + propuesta de partir en dos items);
- una sola dirección de cámara (detectar contradicciones: "dolly in" + "órbita" + "estático");
- identidad anclada: si hay personaje, debe existir referencia del Cast asignada;
- sin 3+ sujetos;
- texto/logo/legal: si el prompt pide texto en pantalla → warning y mover a caption o a
  imagen estática;
- toda referencia debe tener `role` (nada de "@Image 1 como referencia" a secas);
- coherencia de ritmo: acción, cámara y audio alineados (no acción frenética + cámara lenta).

Output: lista de `warnings` con auto-fix cuando sea seguro, o bloqueo si es irrecuperable.

### 7. `antislop.ts` (0.5h)

Lista de términos prohibidos en prompts generados (breathtaking, stunning, cinematic
masterpiece, seamlessly, 8k ultra detailed, masterpiece…) + reemplazo por descripción
concreta. Se aplica como paso final de todo compiler.

### 8. Integración y tests (1h)

- `prompt-enhancer.ts` (V1) queda como utilidad del flujo de generación suelta; el Campaign
  Studio usa `prompt-director`. No romper los call sites existentes.
- Tests unitarios con fixtures: un item por formato × compiler → snapshot del CompiledPrompt;
  casos del validador (cada regla con su caso que dispara). Sin APIs reales.

## Criterio de cierre

- `compile()` produce prompts válidos para los 9 formatos con Seedance y para imagen con
  FLUX/Nano Banana.
- El validador detecta los 7 tipos de error con tests verdes.
- Revisión manual: 3 prompts compilados leídos contra `docs/modelos/seedance-2.md` — sin
  contradicciones con los límites del modelo.
