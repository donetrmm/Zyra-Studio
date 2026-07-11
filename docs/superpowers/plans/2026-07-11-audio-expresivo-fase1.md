# Audio expresivo Fase 1 (Seedance) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reducir la planitud/monotonía del habla en videos Seedance inyectando un cue de entrega EN INGLÉS pegado a la cita del diálogo (default por registro/emoción + override por beat), rebalanceando `DIALOGUE_LANGUAGE` de forma ritmo-neutral, y quitando la música en clips con voz.

**Architecture:** Lógica pura nueva en `lib/campaigns/voice-tone.ts` (mapa es→en, `deliveryCueFor`, `injectDeliveryCue`), consumida por el compiler Seedance y por la UI. El tono por beat se guarda en `campaign_items.voice_tone` (migración 064) y viaja al compiler por el mismo camino que `duration_s` (select del orchestrator → `CompileRequest.voiceTone`). NO se toca el ritmo (WPS/HEADROOM/articulación = Fase 2).

**Tech Stack:** Next.js 15 (App Router, RSC + server actions), Supabase (Postgres + RLS), Zod, Vitest, TypeScript. Video: Seedance 2.0 (audio nativo). Vercel AI Gateway para imagen (no aplica aquí).

## Global Constraints

- **Sin `any`**: `unknown` + narrowing o tipo explícito.
- **`'use server'` no exporta no-funciones**: en `server-actions/*.ts` NO exportar consts/tipos/objetos — rompe prod aunque typecheck/lint pasen. `pnpm build` es obligatorio.
- **Ritmo-neutral (Fase 1)**: NO tocar `WPS`/`HEADROOM_S`/`MIN_AIR_S` (`lib/campaigns/speech-fit.ts`) ni la cláusula de articulación de `DIALOGUE_LANGUAGE`. Los descriptores de tono NUNCA dicen "rápido/lento".
- **Idioma**: el diálogo va en es-MX; las directivas de entrega al modelo van EN INGLÉS. UI en español (chips) → mapeo a inglés en el compiler.
- **Conservar guardrails de `DIALOGUE_LANGUAGE`**: es-MX/anti-castellano ("seseo", "Castilian … th") y la articulación ("full value to each syllable … without rushing through consonant clusters") quedan intactos.
- **Créditos**: sin cambios (editar tono/audio no genera; los turnos ya cobran aparte).
- **Orden migración→push**: la migración 064 se aplica a prod vía MCP ANTES del deploy. Verificar `project_id` (`dzqhngfwlgxkmxohlwun`) vs `.env.local`. NO aplicar dentro de las tasks.
- **Tests sin APIs reales**: unidades puras deterministas; el smoke con audio real lo corre el usuario (árbitro de "menos plano").
- **Supabase client SIN tipar** (`createServerClient` sin `<Database>`): escribir/leer `voice_tone` NO requiere tocar tipos generados.
- **Commits sin `Co-Authored-By`.** Conventional Commits en español, imperativo, ≤70 chars la primera línea. No emojis en código/UI.
- Gestor de paquetes: **pnpm** (`pnpm vitest`, `pnpm typecheck`, `pnpm build`).

## File Structure

- `lib/campaigns/voice-tone.ts` (nuevo) — puro, client-safe: `VOICE_TONE_MAP` (es→en), `VOICE_TONE_LABELS` (chips), `deliveryCueFor`, `injectDeliveryCue`.
- `lib/campaigns/voice-tone.test.ts` (nuevo) — tests puros de lo anterior.
- `lib/prompt-director/types.ts` (mod) — `CompileRequest` gana `voiceTone?`.
- `lib/prompt-director/compilers/seedance.ts` (mod) — inyección adyacente del cue, `DIALOGUE_LANGUAGE` rebalanceada, `VOICE_FORWARD_AUDIO` (no music si hay voz); retira el push global de `voiceToneForRegister`.
- `lib/prompt-director/compilers/seedance-dialogue.test.ts` (mod) — test de contenido de la `DIALOGUE_LANGUAGE` nueva.
- `supabase/migrations/064_campaign_item_voice_tone.sql` (nuevo) — columna `voice_tone`.
- `lib/campaigns/orchestrator.ts` (mod) — select + tipo de fila + `voiceTone` en el `CompileRequest`.
- `server-actions/storyboard.ts` (mod) — `setBeatAudioAction` gana `voiceTone`, persiste `voice_tone`.
- `app/app/campaigns/[id]/storyboard/page.tsx` (mod) — trae `voice_tone`, lo pasa como `beat.voiceTone`.
- `components/campaigns/StoryboardView.tsx` (mod) — input "Tono / entrega" + chips; `audioDraft`/`handleSaveAudio` threading; tipo de beat gana `voiceTone`.

---

### Task 1: Módulo puro `voice-tone.ts` (cue de entrega)

**Files:**
- Create: `lib/campaigns/voice-tone.ts`
- Test: `lib/campaigns/voice-tone.test.ts`

**Interfaces:**
- Consumes: `declaresHighEmotion`, `ENERGETIC_REGISTER_RE` de `@/lib/prompt-director/acting` (ya existen).
- Produces:
  - `VOICE_TONE_MAP: Record<string, string>` (etiqueta española → descriptor inglés)
  - `VOICE_TONE_LABELS: string[]` (claves del mapa = chips de la UI)
  - `deliveryCueFor(voiceTone: string | null | undefined, register: string, scenePrompt: string): string`
  - `injectDeliveryCue(action: string, cue: string): string`

- [ ] **Step 1: Escribir el test que falla** (`lib/campaigns/voice-tone.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { deliveryCueFor, injectDeliveryCue, VOICE_TONE_MAP, VOICE_TONE_LABELS } from './voice-tone';

describe('deliveryCueFor', () => {
  it('override con etiqueta conocida usa el mapeo inglés', () => {
    const cue = deliveryCueFor('cálido', 'ugc', 'una escena');
    expect(cue).toContain('warm, personable');
    expect(cue.endsWith('— ')).toBe(true);
  });
  it('override de texto libre pasa el español dentro del envoltorio inglés', () => {
    const cue = deliveryCueFor('misterioso', 'ugc', 'una escena');
    expect(cue).toContain('misterioso');
    expect(cue.startsWith('Deliver the line in a ')).toBe(true);
  });
  it('vacío + registro enérgico → descriptor upbeat', () => {
    expect(deliveryCueFor('', 'bold kinetic', 'una escena')).toContain('upbeat');
  });
  it('vacío + registro default → warm, lively, expressive', () => {
    expect(deliveryCueFor(null, 'ugc casero', 'una escena')).toContain('warm, lively, expressive');
  });
  it('vacío + emoción alta declarada gana sobre el registro', () => {
    expect(deliveryCueFor('', 'ugc casero', 'she sobs and cries')).toContain('emotionally intense');
  });
});

describe('injectDeliveryCue', () => {
  const cue = 'Deliver the line in a warm tone — ';
  it('prefija el cue justo antes del marcador Dialogue:', () => {
    const out = injectDeliveryCue('She looks at camera. Dialogue: "Por fin."', cue);
    expect(out).toBe('She looks at camera. Deliver the line in a warm tone — Dialogue: "Por fin."');
  });
  it('sin marcador, prefija antes del primer entrecomillado', () => {
    const out = injectDeliveryCue('Voice over: "Se ve increíble."', cue);
    expect(out).toContain('warm tone — "Se ve increíble."');
  });
  it('sin cita, agrega el cue al final', () => {
    const out = injectDeliveryCue('Product close-up, no one speaks.', cue);
    expect(out.endsWith('Deliver the line in a warm tone —')).toBe(true);
  });
  it('soporta comillas curvas en el marcador', () => {
    const out = injectDeliveryCue('She speaks. Dialogue: “Hola.”', cue);
    expect(out).toContain('warm tone — Dialogue: “Hola.”');
  });
});

describe('VOICE_TONE_LABELS', () => {
  it('expone las etiquetas de los chips en español', () => {
    expect(VOICE_TONE_LABELS).toContain('cálido');
    expect(VOICE_TONE_LABELS.length).toBe(Object.keys(VOICE_TONE_MAP).length);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run lib/campaigns/voice-tone.test.ts`
Expected: FAIL (`voice-tone` no existe).

- [ ] **Step 3: Crear `lib/campaigns/voice-tone.ts`**

```typescript
// Cue de entrega de voz para Seedance (Fase 1 audio, 2026-07-11): reduce la
// planitud inyectando un descriptor de tono EN INGLÉS pegado a la cita del
// diálogo. Puro y client-safe (la UI importa las etiquetas). El diálogo sigue en
// es-MX; esta directiva describe CÓMO se entrega, nunca la VELOCIDAD (el ritmo es
// Fase 2 — los descriptores no dicen "rápido/lento").
import { declaresHighEmotion, ENERGETIC_REGISTER_RE } from '@/lib/prompt-director/acting';

// Etiqueta española (chip / valor guardado) → descriptor de entrega en inglés.
export const VOICE_TONE_MAP: Record<string, string> = {
  cálido: 'warm, personable',
  entusiasta: 'upbeat, enthusiastic',
  serio: 'serious, grounded',
  juguetón: 'playful, light',
  íntimo: 'intimate, soft, close to the mic',
  seguro: 'confident, self-assured',
};

// Chips que ofrece la UI (labels en español = claves del mapa).
export const VOICE_TONE_LABELS: string[] = Object.keys(VOICE_TONE_MAP);

// Default expresivo según registro + emoción declarada (inglés, corto). Reemplaza
// el null del viejo voiceToneForRegister: TODO clip con voz recibe algo expresivo.
function defaultDescriptor(register: string, scenePrompt: string): string {
  if (declaresHighEmotion(scenePrompt)) {
    return 'expressive and emotionally intense, letting the strong feeling come through fully';
  }
  const r = register.toLowerCase();
  if (/asmr|susurro|whisper|macro/.test(r)) return 'intimate, soft, close to the mic';
  if (/calle|street|vox|interview|entrevista|espont/.test(r)) return 'spontaneous, candid, lightly energetic';
  if (ENERGETIC_REGISTER_RE.test(r)) return 'confident, upbeat, punchy';
  if (/cinemat|[eé]pic|gran ?pantalla|brand ?film|emotiv/.test(r)) return 'sincere, warm, emotionally grounded';
  return 'warm, lively, expressive';
}

// Frase de entrega EN INGLÉS lista para prefijar a la cita. voiceTone (override del
// usuario, en español): etiqueta conocida → su mapeo inglés; texto libre → pasa tal
// cual dentro del envoltorio inglés. Vacío/null → default por registro/emoción.
export function deliveryCueFor(
  voiceTone: string | null | undefined,
  register: string,
  scenePrompt: string,
): string {
  const raw = (voiceTone ?? '').trim();
  const descriptor = raw
    ? (VOICE_TONE_MAP[raw.toLowerCase()] ?? raw)
    : defaultDescriptor(register, scenePrompt);
  return `Deliver the line in a ${descriptor} tone — `;
}

// Prefija el cue a la cita dentro de la acción. Preferencia: 1) marcador
// Dialogue:/Diálogo:; 2) primer entrecomillado; 3) sin cita → cue al final. Solo
// toca la acción, nunca el andamiaje (@imageN, 9:16, marcadores de segundos).
const DIALOGUE_MARKER_RE = /(?:dialogue|di[aá]logo)\s*:\s*["“]/i;
const FIRST_QUOTE_RE = /["“][^"“”]{2,}["”]/;

export function injectDeliveryCue(action: string, cue: string): string {
  if (DIALOGUE_MARKER_RE.test(action)) {
    return action.replace(DIALOGUE_MARKER_RE, (m) => `${cue}${m}`);
  }
  if (FIRST_QUOTE_RE.test(action)) {
    return action.replace(FIRST_QUOTE_RE, (m) => `${cue}${m}`);
  }
  return `${action} ${cue}`.trimEnd();
}
```

- [ ] **Step 4: Correr el test**

Run: `pnpm vitest run lib/campaigns/voice-tone.test.ts`
Expected: PASS (todos verdes).

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/voice-tone.ts lib/campaigns/voice-tone.test.ts
git commit -m "feat(audio): modulo puro de cue de entrega de voz para seedance"
```

---

### Task 2: Compiler Seedance — cue adyacente, no-music y `DIALOGUE_LANGUAGE`

**Files:**
- Modify: `lib/prompt-director/types.ts` (`CompileRequest` gana `voiceTone?`)
- Modify: `lib/prompt-director/compilers/seedance.ts`
- Test: `lib/prompt-director/compilers/seedance-dialogue.test.ts` (contenido de `DIALOGUE_LANGUAGE`)

**Interfaces:**
- Consumes: `deliveryCueFor`, `injectDeliveryCue` (Task 1).
- Produces: `CompileRequest.voiceTone?: string | null` (lo puebla Task 3).

**Nota:** no existe harness de `compileSeedance` en tests (los tests del compiler son de helpers puros). La lógica pura ya está cubierta por Task 1; aquí el test cubre la `DIALOGUE_LANGUAGE` (constante), y el cableado se valida con `pnpm typecheck && pnpm build` + el smoke real del usuario.

- [ ] **Step 1: Agregar `voiceTone` a `CompileRequest`** (`lib/prompt-director/types.ts`, dentro del type `CompileRequest`, junto a `durationS`)

```typescript
  // Tono/entrega por clip (es, override del usuario) o null/undefined → default
  // por registro/emoción. El compiler lo convierte a un cue de entrega en inglés
  // pegado a la cita del diálogo. NO afecta la velocidad (ritmo = Fase 2).
  voiceTone?: string | null;
```

- [ ] **Step 2: Escribir el test que falla de `DIALOGUE_LANGUAGE`** (append a `lib/prompt-director/compilers/seedance-dialogue.test.ts`)

```typescript
import { DIALOGUE_LANGUAGE } from './seedance';

describe('DIALOGUE_LANGUAGE rebalanceada (Fase 1 audio)', () => {
  it('lidera con expresividad sin perder los guardrails es-MX ni la articulación', () => {
    const es = DIALOGUE_LANGUAGE.es;
    // Nuevo: prosodia expresiva y contención SOLO visual.
    expect(es).toMatch(/expressive/i);
    expect(es).toMatch(/emphasize/i);
    expect(es).toMatch(/face and gestures/i);
    // Conservado: es-MX / anti-castellano.
    expect(es).toContain('seseo');
    expect(es).toContain('Castilian');
    // Conservado: articulación (ritmo-neutral, Fase 2 no se toca).
    expect(es).toContain('full value');
    expect(es).toContain('consonant clusters');
    // Ya NO frena la voz como antes ("exaggerated acting" quitado del eje vocal).
    expect(es).not.toMatch(/exaggerated acting/i);
  });
  it('la variante en conserva la articulación y la expresividad', () => {
    expect(DIALOGUE_LANGUAGE.en).toMatch(/expressive/i);
    expect(DIALOGUE_LANGUAGE.en).toContain('full value');
  });
});
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `pnpm vitest run lib/prompt-director/compilers/seedance-dialogue.test.ts`
Expected: FAIL (la `DIALOGUE_LANGUAGE` actual no contiene "expressive"/"face and gestures" y sí "exaggerated acting").

- [ ] **Step 4: Rebalancear `DIALOGUE_LANGUAGE`** (`lib/prompt-director/compilers/seedance.ts`, reemplazar el objeto `DIALOGUE_LANGUAGE`, líneas ~60-66)

```typescript
export const DIALOGUE_LANGUAGE: Record<'es' | 'en', string> = {
  es: 'All spoken dialogue and any voice-over must be in Mexican Latin American Spanish (es-MX) with a natural Mexican accent — never a Castilian accent from Spain: pronounce c and z as a soft s (Latin American seseo), never as the Castilian "th" sound, and use Mexican intonation, rhythm and vocabulary. Perform the line with expressive, dynamic vocal delivery: vary pitch and intonation, emphasize the key words, and let real emotion ride through the voice, with a warm conversational tone, subtle pauses and breathing and natural emotional variation — speak as if talking to a friend, never flat, monotone, robotic or announcer-like. Keep this expressiveness in the VOICE; any on-camera restraint applies only to the face and gestures, not to the vocal delivery. Even while natural, articulate every word completely and correctly: give each syllable of longer or less common words its full value, without slurring, dropping endings or rushing through consonant clusters.',
  en: 'All spoken dialogue and any voice-over must be in English. Perform the line with expressive, dynamic vocal delivery: vary pitch and intonation, emphasize the key words, and let real emotion ride through the voice, with a warm conversational tone, subtle pauses and breathing and natural emotional variation — speak as if talking to a friend, never flat, monotone, robotic or announcer-like. Keep this expressiveness in the VOICE; any on-camera restraint applies only to the face and gestures, not to the vocal delivery. Even while natural, articulate every word completely and correctly: give each syllable of longer or less common words its full value, without slurring, dropping endings or rushing through consonant clusters.',
};
```

- [ ] **Step 5: Correr el test de `DIALOGUE_LANGUAGE`**

Run: `pnpm vitest run lib/prompt-director/compilers/seedance-dialogue.test.ts`
Expected: PASS.

- [ ] **Step 6: Agregar el import y la constante `VOICE_FORWARD_AUDIO`** (`lib/prompt-director/compilers/seedance.ts`)

Import (junto a los imports del archivo):

```typescript
import { deliveryCueFor, injectDeliveryCue } from '@/lib/campaigns/voice-tone';
```

Constante (junto a `audioDirection`, ~línea 457):

```typescript
// Clips con voz (diálogo o voz en off): sin música para que la voz no compita.
// "no music" literal es más fiable que "no background music". Los clips SIN voz
// conservan su música por registro (audioDirection).
const VOICE_FORWARD_AUDIO =
  'Audio: no music — the spoken voice carries the scene; keep only subtle diegetic room tone under the dialogue, with the voice clear and forward in the mix.';
```

- [ ] **Step 7: Inyectar el cue adyacente y quitar el push global de tono** (`lib/prompt-director/compilers/seedance.ts`)

En el bloque de la acción (~líneas 605-606), envolver la acción con el cue cuando hay voz:

```typescript
  const action0 = splitLongDialogues(applyRespellings(normalizeSpokenInDialogue(rawAction)));
  const action = voiced
    ? injectDeliveryCue(action0, deliveryCueFor(req.voiceTone, ctx.format?.register ?? '', req.scenePrompt))
    : action0;
  sections.push(action);
```

En el bloque de audio dirigido (~líneas 643-645), ramificar por `voiced`:

```typescript
  if (generateAudio && !ctx.audioRefPath) {
    sections.push(voiced ? VOICE_FORWARD_AUDIO : audioDirection(ctx.format?.register ?? ''));
  }
```

En el bloque de voz (~líneas 649-652), quitar el push global de `voiceToneForRegister` (el cue adyacente lo reemplaza):

```typescript
  if (voiced) {
    sections.push(DIALOGUE_LANGUAGE[ctx.language ?? 'es']);
  } else if (generateAudio) {
    sections.push('No spoken dialogue or voice-over; ambient sound only.');
  }
```

Borrar la función `voiceToneForRegister` (ahora sin uso). Verificar con grep que no quede consumidor:

Run: `pnpm exec grep -rn "voiceToneForRegister" lib/ server-actions/`
Expected: sin coincidencias tras el borrado. Si aparece en el path de PREVIEW del orchestrator (`orchestrator.ts` ~666-723, "mismos gates y constantes"), aplicar ahí el MISMO tratamiento (inyectar `deliveryCueFor`/`injectDeliveryCue`, ramificar audio por `voiced`) para paridad; si no es trivial, anotarlo como MINOR en el reporte (el preview NO bloquea la generación real).

- [ ] **Step 8: Verificación completa**

Run: `pnpm vitest run && pnpm typecheck && pnpm build`
Expected: suite PASS, typecheck limpio, build verde.

- [ ] **Step 9: Commit**

```bash
git add lib/prompt-director/types.ts lib/prompt-director/compilers/seedance.ts lib/prompt-director/compilers/seedance-dialogue.test.ts
git commit -m "feat(audio): cue de entrega adyacente y no-music en clips hablados"
```

---

### Task 3: Migración 064 + cableado `voice_tone` al compiler

**Files:**
- Create: `supabase/migrations/064_campaign_item_voice_tone.sql`
- Modify: `lib/campaigns/orchestrator.ts`

**Interfaces:**
- Consumes: `CompileRequest.voiceTone` (Task 2).
- Produces: `campaign_items.voice_tone` (columna) llega al compiler como `req.voiceTone`.

**Nota:** el cliente Supabase no está tipado, así que leer `voice_tone` no requiere tipos generados. Es IO — el gate es `pnpm typecheck && pnpm build` (no hay unidad pura que agregar).

- [ ] **Step 1: Crear la migración 064** (`supabase/migrations/064_campaign_item_voice_tone.sql`)

```sql
-- 064 Tono/entrega de voz por clip (Fase 1 audio expresivo). Idempotente.
-- NO se aplica dentro de las tareas; el controller la aplica vía MCP ANTES del
-- deploy (orden migración→push). Nullable, sin default (vacío = default por registro).
alter table campaign_items add column if not exists voice_tone text;
```

- [ ] **Step 2: Agregar `voice_tone` al tipo de fila del ítem** (`lib/campaigns/orchestrator.ts`, en la interfaz/type de la fila del ítem que tiene `scene_prompt: string;`, ~línea 51)

```typescript
  voice_tone: string | null;
```

- [ ] **Step 3: Traer `voice_tone` en el SELECT de ítems** (`lib/campaigns/orchestrator.ts`, el `.select('id, scene_prompt, scene, duration_s, ...')`, ~línea 852)

Agregar `voice_tone` a la lista de columnas del select (p. ej. tras `duration_s`):

```typescript
    .select('id, scene_prompt, scene, duration_s, voice_tone, aspect_ratio, audio, scene_index, generation_id, character_id, character_ids, character_state_hint, character_outfit_hint')
```

- [ ] **Step 4: Pasar `voiceTone` al `CompileRequest`** (`lib/campaigns/orchestrator.ts`, donde se arma el objeto del `compile(...)`, ~línea 1211, junto a `scenePrompt`/`durationS`)

```typescript
        scenePrompt: item.scene_prompt,
        durationS: item.duration_s ?? undefined,
        voiceTone: item.voice_tone ?? undefined,
```

- [ ] **Step 5: Verificación**

Run: `pnpm typecheck && pnpm build`
Expected: PASS. Confirmar que el select y el tipo de fila incluyen `voice_tone` y que el `compile(...)` lo pasa. (Si el path de preview arma otro `CompileRequest`, pasarle también `voiceTone: item.voice_tone ?? undefined` para paridad, o anotarlo MINOR.)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/064_campaign_item_voice_tone.sql lib/campaigns/orchestrator.ts
git commit -m "feat(audio): columna voice_tone y su cableado al compiler"
```

---

### Task 4: `setBeatAudioAction` persiste el tono

**Files:**
- Modify: `server-actions/storyboard.ts` (`setBeatAudioAction`, ~líneas 645-675)

**Interfaces:**
- Consumes: columna `voice_tone` (Task 3).
- Produces: `setBeatAudioAction(itemId, dialogue, durationS, voiceTone: string | null): Promise<Result<{ updated: true }>>`.

**Nota:** IO (Supabase) — el gate es `pnpm typecheck && pnpm build`; no se agregan tests con API real (regla del repo).

- [ ] **Step 1: Agregar el parámetro `voiceTone`, validarlo y persistirlo** (`server-actions/storyboard.ts`)

Cambiar la firma y el cuerpo de `setBeatAudioAction`. `voiceTone` va con default `= null`
para que el único call site actual (StoryboardView, 3 args) siga compilando; Task 5 lo
cablea con el valor real del draft.

```typescript
export async function setBeatAudioAction(
  itemId: string,
  dialogue: string,
  durationS: number,
  voiceTone: string | null = null,
): Promise<Result<{ updated: true }>> {
  if (!itemId) return { ok: false, error: 'validation_error', message: 'itemId requerido' };
  if (typeof dialogue !== 'string' || dialogue.length > 600) {
    return { ok: false, error: 'validation_error', message: 'diálogo inválido (máx 600 caracteres)' };
  }
  if (!Number.isInteger(durationS) || durationS < 4 || durationS > 15) {
    return { ok: false, error: 'validation_error', message: 'duración fuera del rango 4-15s' };
  }
  const tone = typeof voiceTone === 'string' ? voiceTone.trim() : '';
  if (tone.length > 80) {
    return { ok: false, error: 'validation_error', message: 'tono inválido (máx 80 caracteres)' };
  }
  const cleanTone = tone.length > 0 ? tone : null;

  const { workspace } = await requireWorkspace();
  const loaded = await loadItemAndCampaign(workspace.id, itemId);
  if (!loaded) return { ok: false, error: 'not_found' };
  const { item, campaign } = loaded;

  const nextPrompt = replaceDialogue(item.scene_prompt, dialogue);

  const supabase = await createClient();
  const { error } = await supabase
    .from('campaign_items')
    .update({ scene_prompt: nextPrompt, duration_s: durationS, voice_tone: cleanTone })
    .eq('id', itemId);
  if (error) return { ok: false, error: 'internal_error', message: error.message };

  revalidatePath(`/app/campaigns/${campaign.id}/storyboard`);
  revalidatePath(`/app/campaigns/${campaign.id}`);
  return { ok: true, data: { updated: true } };
}
```

- [ ] **Step 2: Verificación**

Run: `pnpm typecheck && pnpm build`
Expected: PASS. El default `= null` mantiene compatible el call site de StoryboardView (3 args) hasta que Task 5 lo cablee.

- [ ] **Step 3: Commit**

```bash
git add server-actions/storyboard.ts
git commit -m "feat(audio): setBeatAudioAction guarda el tono del beat"
```

---

### Task 5: UI — input "Tono / entrega" + chips en la sección Audio

**Files:**
- Modify: `app/app/campaigns/[id]/storyboard/page.tsx` (trae `voice_tone`, lo pasa como `beat.voiceTone`)
- Modify: `components/campaigns/StoryboardView.tsx` (tipo de beat + `audioDraft`/`handleSaveAudio` + input + chips)

**Interfaces:**
- Consumes: `setBeatAudioAction(..., voiceTone)` (Task 4), `VOICE_TONE_LABELS` (Task 1).

**Nota:** UI/IO — gate `pnpm typecheck && pnpm build`. El smoke visual lo corre el usuario.

- [ ] **Step 1: Traer `voice_tone` en la carga de beats del storyboard** (`app/app/campaigns/[id]/storyboard/page.tsx`)

Localizar el `.select(...)` de `campaign_items` que alimenta los beats y agregar `voice_tone` a las columnas; en el mapeo del beat, agregar `voiceTone: (row.voice_tone as string | null) ?? null` (usar el mismo estilo de casteo del archivo). Verificar con grep dónde se arma el objeto beat (busca `scenePrompt:` / `durationS:` en la page).

Run: `pnpm exec grep -n "scenePrompt\|durationS\|voice_tone\|\.select(" app/app/campaigns/[id]/storyboard/page.tsx`

- [ ] **Step 2: Agregar `voiceTone` al tipo de beat de `StoryboardView`** (`components/campaigns/StoryboardView.tsx`)

En el tipo del beat (el que ya tiene `scenePrompt: string; durationS: number; sceneIndex: number;`), agregar:

```typescript
  voiceTone: string | null;
```

- [ ] **Step 3: Incluir `voiceTone` en `audioDraft`** (`components/campaigns/StoryboardView.tsx`, el `useState` de `audioDraft`, ~línea 366)

Extender el tipo del draft y su inicialización para incluir `voiceTone`:

```typescript
  const [audioDraft, setAudioDraft] = useState<Record<string, { dialogue: string; durationS: number; voiceTone: string }>>(() => {
    const init: Record<string, { dialogue: string; durationS: number; voiceTone: string }> = {};
    for (const b of beats) init[b.id] = { dialogue: extractDialogue(b.scenePrompt), durationS: b.durationS, voiceTone: b.voiceTone ?? '' };
    return init;
  });
```

- [ ] **Step 4: `handleSaveAudio` manda el tono** (`components/campaigns/StoryboardView.tsx`, ~línea 373)

```typescript
    const res = await setBeatAudioAction(beatId, draft.dialogue, draft.durationS, draft.voiceTone.trim() || null);
```

- [ ] **Step 5: Importar los chips** (`components/campaigns/StoryboardView.tsx`)

```typescript
import { VOICE_TONE_LABELS } from '@/lib/campaigns/voice-tone';
```

- [ ] **Step 6: Agregar el input "Tono / entrega" + chips en la sección Audio** (`components/campaigns/StoryboardView.tsx`, dentro del bloque de audio, tras el medidor `<p className={...}>{meter.text}</p>` y antes del botón "Guardar audio", ~línea 834)

```tsx
                      <div className="flex flex-col gap-1">
                        <input
                          type="text"
                          value={draft.voiceTone}
                          aria-label={`Tono de la escena ${beat.sceneIndex + 1}`}
                          onChange={(e) =>
                            setAudioDraft((prev) => ({ ...prev, [beat.id]: { ...draft, voiceTone: e.target.value } }))
                          }
                          placeholder="Tono / entrega (opcional) — ej. cálido, entusiasta"
                          maxLength={80}
                          className="min-w-0 rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                        />
                        <div className="flex flex-wrap gap-1">
                          {VOICE_TONE_LABELS.map((label) => (
                            <button
                              key={label}
                              type="button"
                              onClick={() =>
                                setAudioDraft((prev) => ({ ...prev, [beat.id]: { ...draft, voiceTone: label } }))
                              }
                              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-foreground"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
```

- [ ] **Step 7: Verificación**

Run: `pnpm vitest run && pnpm typecheck && pnpm build`
Expected: suite PASS, typecheck limpio, build verde.

- [ ] **Step 8: Commit**

```bash
git add app/app/campaigns/[id]/storyboard/page.tsx components/campaigns/StoryboardView.tsx
git commit -m "feat(audio): input de tono por beat con chips en el storyboard"
```

---

## Post-implementación (fuera de las tasks, lo coordina el controller)

- **Aplicar la migración 064 a prod vía MCP** ANTES del deploy (orden migración→push). Verificar `project_id` `dzqhngfwlgxkmxohlwun` vs `.env.local`.
- **Actualizar memoria** (`project_lipsync_dialogo_fragmentado` / nueva nota de audio): la planitud se ataca con cue de entrega adyacente + no-music + `DIALOGUE_LANGUAGE` expresiva; el ritmo sigue en Fase 2.
- **Smokes del usuario (API real, árbitro):**
  1. Regenerar un clip hablado (sin tono) y comparar expresividad antes/después.
  2. Setear un chip de tono ("entusiasta") en un beat, regenerar, oír el cambio.
  3. Un clip hablado en registro enérgico/cinemático: confirmar que ya NO trae cama de música compitiendo con la voz.
  4. Confirmar que la pronunciación es-MX y el lip-sync NO se degradan (guardrails intactos).

## Self-Review (hecho)

- **Cobertura del spec:** columna `voice_tone` + migración 064 (T3); cue adyacente default+override (T1 lógica + T2 wiring); `DIALOGUE_LANGUAGE` rebalanceada ritmo-neutral (T2); "no music" en clips con voz (T2); UI input+chips es→en (T5); `setBeatAudioAction` persiste (T4); cableado orchestrator (T3). Idioma es→en (T1 `VOICE_TONE_MAP` + T5 chips). Fuera de alcance (ritmo/voz-por-personaje) respetado. Cubierto.
- **Placeholders:** ninguno; los `~línea` son anclas aproximadas con código exacto en cada paso.
- **Consistencia de tipos:** `voiceTone`/`voice_tone` coherente: `deliveryCueFor(voiceTone,...)` (T1) → `CompileRequest.voiceTone` (T2) → `item.voice_tone`→`voiceTone` (T3) → `setBeatAudioAction(...,voiceTone)` (T4) → `draft.voiceTone`/`beat.voiceTone` (T5). `VOICE_TONE_LABELS`/`VOICE_TONE_MAP` usados en T1/T5. `injectDeliveryCue`/`deliveryCueFor` usados en T2. Nombres consistentes.
