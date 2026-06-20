# Refinamiento de audio en el Storyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una sección de audio por beat en el storyboard donde el usuario edita el diálogo y la duración del clip, guiado por un medidor de holgura que predice si la voz saldrá natural o apresurada.

**Architecture:** Helpers puros (`lib/campaigns/speech-fit.ts`) que extraen/reescriben el diálogo dentro de `scene_prompt` y estiman si cabe en la duración. Una server action (`setBeatAudioAction`) que persiste diálogo + duración en `campaign_items` sin generar nada. UI en `StoryboardView` que usa los helpers en vivo. Sin migración (diálogo en `scene_prompt`, duración en `duration_s`; el compiler Seedance ya los lee).

**Tech Stack:** Next.js 15, React (client component), TypeScript, Supabase, Vitest. Spec: `docs/superpowers/specs/2026-06-20-audio-refine-storyboard-design.md`.

## Global Constraints

- **No `any`**; `unknown` + narrowing o tipo explícito.
- **El diálogo vive en `campaign_items.scene_prompt`** (el compiler Seedance lo lee de ahí con `hasSpokenDialogue`/`sceneHasVoice`); la duración en `campaign_items.duration_s`. **Sin migración.**
- **Rango de duración Seedance: 4-15s** (`DUR_MIN=4`, `DUR_MAX=15`).
- **Ritmo implícito por holgura** (más segundos por palabra = más pausado); sin toggle ni columna de ritmo.
- Server actions validan ownership de workspace y NO tocan créditos (esta no genera nada). Estilo de validación: manual, como el `setStoryboardLocationAction` vecino (este archivo NO importa zod).
- Los helpers son **puros y compartidos** (cliente + servidor): `lib/campaigns/speech-fit.ts` NO lleva `server-only`.
- Tests sin APIs reales (Vitest, unit puros). pnpm. Commits en español, conventional, **sin** `Co-Authored-By`. `git add` solo los archivos de cada task (no `git add -A`).

---

### Task 1: Helpers puros `speech-fit.ts`

**Files:**
- Create: `lib/campaigns/speech-fit.ts`
- Test: `lib/campaigns/speech-fit.test.ts`

**Interfaces:**
- Produces:
  - `extractDialogue(scenePrompt: string): string`
  - `replaceDialogue(scenePrompt: string, nuevo: string): string`
  - `countWords(text: string): number`
  - `estimateSpeechSeconds(dialogo: string, lang: 'es' | 'en'): number`
  - `fitVerdict(neededS: number, durationS: number): { level: 'tight' | 'ok' | 'roomy'; suggestedDurationS: number }`
  - constantes: `WPS: Record<'es'|'en', number>`, `HEADROOM_S`, `DUR_MIN`, `DUR_MAX`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `lib/campaigns/speech-fit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  extractDialogue,
  replaceDialogue,
  countWords,
  estimateSpeechSeconds,
  fitVerdict,
  WPS,
  DUR_MIN,
  DUR_MAX,
} from './speech-fit';

describe('extractDialogue', () => {
  it('lee el contenido de Dialogue: "..."', () => {
    expect(extractDialogue('Medium shot — ella sonríe. Dialogue: "Hola a todos"')).toBe('Hola a todos');
  });
  it('soporta comillas curvas', () => {
    expect(extractDialogue('Acción. Dialogue: “Hola”')).toBe('Hola');
  });
  it('cae al primer entrecomillado si no hay marcador', () => {
    expect(extractDialogue('Ella dice "buenos días" a cámara')).toBe('buenos días');
  });
  it('devuelve vacío si no hay diálogo', () => {
    expect(extractDialogue('Medium shot, producto sobre la mesa')).toBe('');
  });
});

describe('replaceDialogue', () => {
  const base = 'Medium shot — ella gesticula hacia el cuadro. Dialogue: "Texto viejo"';
  it('reemplaza el diálogo conservando la acción (round-trip)', () => {
    const out = replaceDialogue(base, 'Texto nuevo');
    expect(extractDialogue(out)).toBe('Texto nuevo');
    expect(out).toContain('ella gesticula hacia el cuadro');
  });
  it('no duplica el marcador Dialogue:', () => {
    const out = replaceDialogue(base, 'Otro');
    expect(out.match(/dialogue\s*:/gi)?.length ?? 0).toBe(1);
  });
  it('quita el diálogo cuando el nuevo es vacío, dejando la acción', () => {
    const out = replaceDialogue(base, '   ');
    expect(extractDialogue(out)).toBe('');
    expect(out).toContain('ella gesticula hacia el cuadro');
  });
  it('agrega Dialogue: cuando no existía', () => {
    const out = replaceDialogue('Medium shot, producto sobre la mesa', 'Nuevo');
    expect(extractDialogue(out)).toBe('Nuevo');
  });
});

describe('countWords', () => {
  it('cuenta palabras separadas por espacios', () => {
    expect(countWords('Mi familia vive en otro estado y casi no los veo')).toBe(11);
  });
  it('cero en vacío', () => {
    expect(countWords('   ')).toBe(0);
  });
});

describe('estimateSpeechSeconds', () => {
  it('usa WPS por idioma (10 palabras es = 4s)', () => {
    expect(estimateSpeechSeconds('uno dos tres cuatro cinco seis siete ocho nueve diez', 'es')).toBeCloseTo(10 / WPS.es);
  });
});

describe('fitVerdict', () => {
  it('tight cuando el diálogo no cabe', () => {
    expect(fitVerdict(6, 5).level).toBe('tight');
  });
  it('ok cuando cabe sin holgura', () => {
    expect(fitVerdict(4.5, 5).level).toBe('ok'); // 0.5 < HEADROOM_S(1)
  });
  it('roomy cuando hay >= 1s de margen', () => {
    expect(fitVerdict(3, 5).level).toBe('roomy');
  });
  it('sugiere duración con clamp al rango Seedance', () => {
    expect(fitVerdict(20, 5).suggestedDurationS).toBe(DUR_MAX); // 20+1 clamp 15
    expect(fitVerdict(0.5, 5).suggestedDurationS).toBe(DUR_MIN); // ceil(1.5)=2 clamp 4
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm test -- speech-fit`
Expected: FAIL — `Cannot find module './speech-fit'`.

- [ ] **Step 3: Implementar `lib/campaigns/speech-fit.ts`**

```ts
// Ajuste del diálogo a la duración del clip: el habla de Seedance sale robótica
// cuando el diálogo no cabe en los segundos (debe acelerar). Estos helpers (puros,
// compartidos cliente/servidor) leen/reescriben el diálogo dentro de scene_prompt
// y estiman si cabe. NO 'server-only'.

// Ritmo conversacional natural (palabras/segundo) por idioma. Tunable.
export const WPS: Record<'es' | 'en', number> = { es: 2.5, en: 2.8 };
// Margen mínimo (s) para considerar el diálogo "holgado" (pausado/natural).
export const HEADROOM_S = 1.0;
// Rango de duración de un clip Seedance.
export const DUR_MIN = 4;
export const DUR_MAX = 15;

// Lee el diálogo de un scene_prompt: 1) contenido de `Dialogue: "..."`;
// 2) primer entrecomillado; 3) '' si no hay. Soporta comillas rectas y curvas.
export function extractDialogue(scenePrompt: string): string {
  const s = scenePrompt ?? '';
  const marked = s.match(/dialogue\s*:\s*["“]([^"”]*)["”]/i);
  if (marked) return marked[1].trim();
  const quoted = s.match(/["“]([^"”]{2,})["”]/);
  if (quoted) return quoted[1].trim();
  return '';
}

// Reescribe el segmento de diálogo dejando intacta la acción visual.
// - nuevo vacío  -> quita el segmento `Dialogue: "..."` (o el primer entrecomillado).
// - existe marcador/entrecomillado -> reemplaza solo el contenido entre comillas.
// - no existe ninguno -> agrega ` Dialogue: "<nuevo>"`.
export function replaceDialogue(scenePrompt: string, nuevo: string): string {
  const s = (scenePrompt ?? '').trim();
  const clean = nuevo.trim();
  const markedContentRe = /(dialogue\s*:\s*["“])([^"”]*)(["”])/i;
  const quotedRe = /(["“])([^"”]{2,})(["”])/;

  if (clean === '') {
    const markedFullRe = /\s*dialogue\s*:\s*["“][^"”]*["”]\s*\.?/i;
    if (markedFullRe.test(s)) return s.replace(markedFullRe, ' ').replace(/\s{2,}/g, ' ').trim();
    if (quotedRe.test(s)) return s.replace(quotedRe, '').replace(/\s{2,}/g, ' ').trim();
    return s;
  }
  if (markedContentRe.test(s)) return s.replace(markedContentRe, `$1${clean}$3`);
  if (quotedRe.test(s)) return s.replace(quotedRe, `$1${clean}$3`);
  return `${s} Dialogue: "${clean}"`;
}

export function countWords(text: string): number {
  const t = (text ?? '').trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

export function estimateSpeechSeconds(dialogo: string, lang: 'es' | 'en'): number {
  return countWords(dialogo) / WPS[lang];
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// Veredicto de ajuste + duración sugerida (clamp al rango Seedance).
export function fitVerdict(
  neededS: number,
  durationS: number,
): { level: 'tight' | 'ok' | 'roomy'; suggestedDurationS: number } {
  const suggestedDurationS = clamp(Math.ceil(neededS + HEADROOM_S), DUR_MIN, DUR_MAX);
  let level: 'tight' | 'ok' | 'roomy';
  if (neededS > durationS) level = 'tight';
  else if (durationS - neededS < HEADROOM_S) level = 'ok';
  else level = 'roomy';
  return { level, suggestedDurationS };
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `pnpm test -- speech-fit`
Expected: PASS (todos). `pnpm typecheck` limpio.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/speech-fit.ts lib/campaigns/speech-fit.test.ts
git commit -m "feat(audio-storyboard): helpers puros de ajuste diálogo↔duración (speech-fit)"
```

---

### Task 2: Server action `setBeatAudioAction`

**Files:**
- Modify: `server-actions/storyboard.ts`

**Interfaces:**
- Consumes: `replaceDialogue` (Task 1), `loadItemAndCampaign` (existente en el archivo), `createClient`, `requireWorkspace`, `revalidatePath`, `Result` (existentes).
- Produces: `setBeatAudioAction(itemId: string, dialogue: string, durationS: number): Promise<Result<{ updated: true }>>`.

- [ ] **Step 1: Importar `replaceDialogue`**

En `server-actions/storyboard.ts`, junto a los imports de `@/lib/campaigns/...`, agregar:

```ts
import { replaceDialogue } from '@/lib/campaigns/speech-fit';
```

- [ ] **Step 2: Agregar la action (validación manual, como `setStoryboardLocationAction`)**

Agregar al final de `server-actions/storyboard.ts`:

```ts
// Refinamiento de audio por beat: reescribe el diálogo dentro de scene_prompt y
// ajusta la duración del clip para que la voz (lip-sync de Seedance) no se apresure.
// No genera nada (texto + duración); el resultado se oye al regenerar el video.
export async function setBeatAudioAction(
  itemId: string,
  dialogue: string,
  durationS: number,
): Promise<Result<{ updated: true }>> {
  if (!itemId) return { ok: false, error: 'validation_error', message: 'itemId requerido' };
  if (typeof dialogue !== 'string' || dialogue.length > 600) {
    return { ok: false, error: 'validation_error', message: 'diálogo inválido (máx 600 caracteres)' };
  }
  if (!Number.isInteger(durationS) || durationS < 4 || durationS > 15) {
    return { ok: false, error: 'validation_error', message: 'duración fuera del rango 4-15s' };
  }

  const { workspace } = await requireWorkspace();
  const loaded = await loadItemAndCampaign(workspace.id, itemId);
  if (!loaded) return { ok: false, error: 'not_found' };
  const { item, campaign } = loaded;

  const nextPrompt = replaceDialogue(item.scene_prompt, dialogue);

  const supabase = await createClient();
  const { error } = await supabase
    .from('campaign_items')
    .update({ scene_prompt: nextPrompt, duration_s: durationS })
    .eq('id', itemId);
  if (error) return { ok: false, error: 'internal_error', message: error.message };

  revalidatePath(`/app/campaigns/${campaign.id}/storyboard`);
  revalidatePath(`/app/campaigns/${campaign.id}`);
  return { ok: true, data: { updated: true } };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: limpio. (Si `loadItemAndCampaign` no expone `scene_prompt`/`campaign.id` con el tipo correcto, ya lo hace: `CampaignItemRow.scene_prompt` y `CampaignRow.id` existen.)

- [ ] **Step 4: Suite (no debe romper nada)**

Run: `pnpm test`
Expected: verde.

- [ ] **Step 5: Commit**

```bash
git add server-actions/storyboard.ts
git commit -m "feat(audio-storyboard): setBeatAudioAction (reescribe diálogo + duración, sin generación)"
```

---

### Task 3: UI — sección de audio por beat

**Files:**
- Modify: `lib/campaigns/storyboard-types.ts` (agregar `durationS` al beat)
- Modify: `app/app/campaigns/[id]/storyboard/page.tsx` (cargar `language` + `duration_s`, pasarlos)
- Modify: `components/campaigns/StoryboardView.tsx` (prop `language`, sección de audio)

**Interfaces:**
- Consumes: `extractDialogue`, `estimateSpeechSeconds`, `fitVerdict`, `countWords` (Task 1); `setBeatAudioAction` (Task 2).

- [ ] **Step 1: Agregar `durationS` a `StoryboardBeat`**

En `lib/campaigns/storyboard-types.ts`:

```ts
export type StoryboardBeat = {
  id: string;
  sceneIndex: number;
  scenePrompt: string;
  storyboardImageId: string | null;
  panelUrl: string | null;
  durationS: number;
};
```

- [ ] **Step 2: La página carga y pasa `language` + `durationS`**

En `app/app/campaigns/[id]/storyboard/page.tsx`:
- En el `.select` de `campaigns`, agregar `language`: `.select('id, name, language')`.
- En el `.select` de `campaign_items`, agregar `duration_s`: `.select('id, scene_index, scene_prompt, storyboard_image_id, location_id, duration_s')`.
- En el `map` a `beats`, agregar `durationS: (r.duration_s as number | null) ?? 8,`.
- Calcular el idioma: `const language = (campaign.language === 'en' ? 'en' : 'es') as 'es' | 'en';`
- Pasar `language={language}` a `<StoryboardView ... />`.

- [ ] **Step 3: `StoryboardView` recibe `language` y monta la sección de audio**

En `components/campaigns/StoryboardView.tsx`:

3a. Imports y prop:

```ts
import { setBeatAudioAction } from '@/server-actions/storyboard';
import { extractDialogue, estimateSpeechSeconds, fitVerdict, countWords } from '@/lib/campaigns/speech-fit';
```

Agregar `language: 'es' | 'en';` al type `Props` y al destructuring de la función.

3b. Estado del editor de audio por beat (junto a los otros `useState`):

```ts
  const [audioDraft, setAudioDraft] = useState<Record<string, { dialogue: string; durationS: number }>>(() => {
    const init: Record<string, { dialogue: string; durationS: number }> = {};
    for (const b of beats) init[b.id] = { dialogue: extractDialogue(b.scenePrompt), durationS: b.durationS };
    return init;
  });
  const [savingAudio, setSavingAudio] = useState<string | null>(null);

  async function handleSaveAudio(beatId: string) {
    const draft = audioDraft[beatId];
    if (!draft) return;
    setSavingAudio(beatId);
    const res = await setBeatAudioAction(beatId, draft.dialogue, draft.durationS);
    setSavingAudio(null);
    if (res.ok) {
      toast.success('Audio guardado · regenera el video para aplicarlo');
      router.refresh();
    } else {
      toast.error(friendlyError(res.error, res.message));
    }
  }
```

3c. Dentro del `.map(beat => ...)`, después de la sección de "Refinar" (input + botón), agregar el bloque de audio:

```tsx
                {/* Audio: diálogo + duración + medidor de holgura */}
                {(() => {
                  const draft = audioDraft[beat.id] ?? { dialogue: extractDialogue(beat.scenePrompt), durationS: beat.durationS };
                  const words = countWords(draft.dialogue);
                  const needed = estimateSpeechSeconds(draft.dialogue, language);
                  const { level, suggestedDurationS } = fitVerdict(needed, draft.durationS);
                  const meter =
                    words === 0
                      ? { text: 'Sin diálogo', cls: 'text-muted-foreground/60' }
                      : level === 'roomy'
                        ? { text: 'Holgado (natural)', cls: 'text-emerald-500' }
                        : level === 'ok'
                          ? { text: 'Justo', cls: 'text-amber-500' }
                          : {
                              text: `Muy ajustado: ~${needed.toFixed(1)}s para ${words} palabras · sube a ${suggestedDurationS}s o acorta`,
                              cls: 'text-red-500',
                            };
                  return (
                    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card/40 p-2">
                      <textarea
                        value={draft.dialogue}
                        onChange={(e) =>
                          setAudioDraft((prev) => ({ ...prev, [beat.id]: { ...draft, dialogue: e.target.value } }))
                        }
                        placeholder="Diálogo (vacío = sin voz)"
                        rows={2}
                        className="min-w-0 resize-none rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:border-primary"
                      />
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-muted-foreground">Duración</label>
                        <input
                          type="number"
                          min={4}
                          max={15}
                          value={draft.durationS}
                          onChange={(e) => {
                            const v = Math.min(15, Math.max(4, Math.round(Number(e.target.value) || 4)));
                            setAudioDraft((prev) => ({ ...prev, [beat.id]: { ...draft, durationS: v } }));
                          }}
                          className="w-16 rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:border-primary"
                        />
                        <span className="text-[11px]">s</span>
                      </div>
                      <p className={`text-[11px] ${meter.cls}`}>{meter.text}</p>
                      <button
                        type="button"
                        disabled={savingAudio === beat.id || generatingAll}
                        onClick={() => void handleSaveAudio(beat.id)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                      >
                        {savingAudio === beat.id ? <Loader2 className="size-3 animate-spin" aria-hidden /> : 'Guardar audio'}
                      </button>
                    </div>
                  );
                })()}
```

(`Loader2` ya está importado en el archivo; `toast`, `friendlyError`, `router`, `generatingAll` ya existen.)

- [ ] **Step 4: Typecheck + suite**

Run: `pnpm typecheck` → limpio.
Run: `pnpm test` → verde (no hay tests de UI; los helpers ya están cubiertos en Task 1).

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/storyboard-types.ts app/app/campaigns/[id]/storyboard/page.tsx components/campaigns/StoryboardView.tsx
git commit -m "feat(audio-storyboard): sección de audio por beat en el storyboard (diálogo + duración + medidor)"
```

- [ ] **Step 6: Smoke (lo corre el usuario)**

En una campaña con storyboard, editar el diálogo/duración de un beat hasta que el medidor diga "holgado", guardar, **regenerar el video** del beat y confirmar que la voz sale natural (no apresurada).

---

## Self-Review

**Cobertura del spec:**
- Helpers (extract/replace/estimate/fit + constantes) → Task 1.
- Server action `setBeatAudioAction` (reescribe diálogo + duración, sin generación/créditos, ownership) → Task 2.
- UI por beat (diálogo + duración + medidor + guardar; página pasa language/durationS; `StoryboardBeat.durationS`) → Task 3.
- Sin migración (diálogo en scene_prompt, duración en duration_s) → respetado en Tasks 2-3.
- Ritmo implícito por holgura (fitVerdict roomy/ok/tight) → Task 1 + medidor en Task 3.
- Testing puro (extract/replace/estimate/fit) → Task 1.

**Placeholders:** ninguno — todo el código va completo; la UI cita los símbolos existentes del archivo (Loader2, toast, friendlyError, router, generatingAll).

**Type consistency:** `setBeatAudioAction(itemId, dialogue, durationS)` (Task 2) == llamada en Task 3. `StoryboardBeat.durationS` (Task 3 step 1) usado en Task 3 step 2/3. `fitVerdict`→`{level,suggestedDurationS}` y `WPS`/`HEADROOM_S`/`DUR_MIN`/`DUR_MAX` consistentes entre Task 1 y el medidor de Task 3. `extractDialogue`/`replaceDialogue` firma consistente Task 1 ↔ Tasks 2-3.
