# División de un guion largo en una secuencia de clips

> Diseño aprobado 2026-06-12. Feature de campañas: cuando el usuario pega un
> guion multi-escena en el wizard, Gemini puede proponer dividirlo en N clips
> que pertenecen a UN anuncio (secuencia), cada uno con su mini-plan, mostrados
> en orden. El usuario confirma o lo colapsa a un solo clip.

## Contexto y problema

El matcher (`lib/prompt-director/format-matcher.ts`) está pensado para mapear
ideas de campaña cortas a formatos. Cuando recibe un guion completo de 15s con
actos (HOOK/DESARROLLO/REVELACIÓN/CIERRE), timestamps y diálogo, hoy produce un
único `scenePrompt`. Aun con el fix del cap (ya no se anula a `null`), un anuncio
así en **un solo clip** de Seedance sale incoherente: el modelo no recuerda entre
tomas, la complejidad crece con la duración, 3+ sujetos reparten la atención y el
prompt compilado roza el techo de 4000 caracteres.

La solución es dividir ese guion en una **secuencia**: N clips cortos (4-8s),
cada uno auto-contenido y coherente, que el usuario ve en orden como las escenas
de un mismo anuncio.

Decisiones tomadas con el usuario:
- Los clips son **un anuncio en N escenas** (secuencia), no creativos sueltos.
- **Gemini sugiere, el usuario confirma** (control para colapsar a 1 clip).
- **Clips separados en secuencia**, sin concatenación server-side.
- Enfoque **A**: columnas aditivas en `campaign_items` (no tabla nueva).

## Alcance

**Dentro:** detección y propuesta de secuencia en el matcher; expansión en el
planner; persistencia y acción de colapsar; agrupación y render en la UI del plan
de campaña.

**Fuera (YAGNI):** concatenación de las escenas en un MP4 final; chaining
last-frame entre escenas para continuidad perfecta; secuencias en el creador de
video standalone (esto vive solo en el plan de campaña).

## 1. Modelo de datos — migración `035_campaign_sequences.sql`

Tres columnas aditivas en `campaign_items`, todas nullable (`null` = creativo
suelto, comportamiento actual intacto):

```sql
alter table campaign_items
  add column sequence_id    uuid,      -- mismo valor para las N escenas de un anuncio
  add column scene_index    integer,   -- orden 0..N-1 dentro de la secuencia
  add column sequence_label text;      -- título del anuncio ("Cuadro familiar")

create index if not exists idx_campaign_items_sequence
  on campaign_items(campaign_id, sequence_id, scene_index);

comment on column campaign_items.sequence_id is
  'Agrupa las escenas de un mismo anuncio; null = creativo independiente';
```

- **RLS**: sin cambios. Las policies `campaign_items_*` (022) cubren columnas nuevas.
- **Realtime**: sin cambios. `campaign_items` ya está en la publicación (025).
- **Backward-compatible**: items previos quedan con `sequence_id = null`.

## 2. Matcher — detección y propuesta (Gemini)

`MatchSchema` gana dos campos opcionales. Un match es **o** un creativo normal
(con `scenePrompt`) **o** una secuencia (con `scenes`):

```ts
// Nueva forma por escena (reusa el clamp de scenePrompt ya existente).
const SceneSchema = z.object({
  scenePrompt: /* string clamp a SCENE_PROMPT_MAX, igual que el match suelto */,
  durationS: z.number().int().min(4).max(15).nullable().catch(null).default(null),
  sceneSummary: z.string().trim().min(1).max(300).nullable().catch(null).default(null),
});

// En MatchSchema:
scenes: z.array(z.unknown()).catch([]).default([])
  .transform(/* sanea cada escena con SceneSchema; descarta malformadas */),
sequenceLabel: z.string().trim().min(1).max(120).nullable().catch(null).default(null),
```

**Instrucción al modelo (system prompt):** si UNA idea es un anuncio
multi-escena ya guionizado (actos/timestamps explícitos, o que claramente no cabe
coherente en un solo clip ≤15s), devuélvela como `scenes[]` — una entrada por
acto/beat, cada una 4-8s, **auto-contenida** (re-describe escena y personaje, el
modelo no recuerda entre clips) — más un `sequenceLabel`. Si no, comportamiento
actual (`scenePrompt` único, `scenes = []`).

**Saneo tolerante (mismo patrón que hoy):**
- `scenes` acotado a **máx 8** entradas.
- Cada `scenePrompt` recortado con `clampToWord` (≤ `SCENE_PROMPT_MAX`).
- Una escena malformada se descarta sin tirar el match.
- Si `scenes` queda **vacío** tras sanear, el match cae a su `scenePrompt` único
  (nunca se pierde el guion).
- Una secuencia con **1 sola** escena válida degrada a creativo normal.

`maxOutputTokens` ya es 4000; un guion partido en escenas cortas cabe holgado.

## 3. Planner — expansión

`DirectedIdea` gana `scenes?` (escenas saneadas) y `sequenceLabel?`.
`PlanItemDraft` gana `sequenceId: string | null`, `sceneIndex: number | null`,
`sequenceLabel: string | null`.

En `buildDirectedPlan`:
- **Idea normal** (sin `scenes`): un `PlanItemDraft`, como hoy (`sequenceId = null`).
- **Idea-secuencia**: N items que comparten un `sequenceId` (`crypto.randomUUID()`),
  con `sceneIndex = 0..N-1`, cada uno con su `scenePrompt`/`durationS`/`sceneSummary`.
  Todos heredan el **mismo formato, aspectRatio, characterIds y fecha**.
- **Continuidad**: mismos `characterIds` + descripciones inventadas en las N
  escenas (Brenda sigue siendo Brenda). Limitación del modelo: identidad no
  garantizada entre clips — se documenta, no se resuelve aquí.
- `interleaveAndSchedule` trata la secuencia como **una unidad** (una fecha del
  round-robin), no como N items dispersos.
- `MAX_PLAN_ITEMS = 30` cuenta las escenas; si la secuencia no cabe entera se
  recorta por el final con aviso (no se inserta media secuencia).

## 4. Persistencia + acción de confirmar

- El `insert` de `generatePlanAction` mapea `sequence_id`, `scene_index`,
  `sequence_label`. Sin cambios en créditos (cada escena se estima como un clip)
  ni en generación (cada item se encola por QStash igual).
- **`mergeSequenceAction(sequenceId)`** (nueva server action): el "no, mándalo
  como un solo clip". Valida ownership (workspace) y que todas las escenas estén
  en `planned`; borra las N e inserta **1 item** cuyo `scenePrompt` es el timeline
  unido de las escenas (join por saltos de línea; el compiler garantiza ≤4000 con
  el recorte ya existente). La `durationS` del item unido es `min(suma de las
  durations, 15)` — el clip único no puede pasar de 15s aunque las escenas sumen
  más. Hereda formato, aspectRatio, characterIds y fecha de la secuencia. Si
  alguna escena ya se generó, rechaza con mensaje claro. Input validado con zod en
  `lib/schemas/campaigns.ts`.

## 5. UI — `components/campaigns/CampaignStudioView.tsx`

- Items **agrupados por `sequence_id`**. Una secuencia se pinta como una tira
  ordenada con cabecera (`sequence_label` + "N escenas" + badge "sugerida por
  IA") y cada escena como su card-clip: `scene_index`, mini-plan
  (`scene_summary`/`scene_prompt`), duración, status realtime y su preview/generación.
- Creativos normales (`sequence_id = null`) se pintan como hoy.
- En la cabecera: acción **"Unir en 1 clip"** → `mergeSequenceAction`.
- Generación sin cambios: cada escena se genera por separado; su status llega por
  realtime como cualquier item.

## 6. Errores y testing

**Degradación sin perder el guion (principio del repo):**
- Matcher: escena malformada descartada; `scenes` vacío → fallback a `scenePrompt`;
  secuencia de 1 escena → item normal.
- Planner: tope de 30 cuenta escenas; secuencia que no cabe se recorta con aviso.
- `mergeSequenceAction`: rechaza si hay escenas ya generadas o ownership inválido.

**Tests unitarios (sin APIs reales — regla del repo):**
- *Matcher* (`format-matcher.test.ts`): respuesta con `scenes[]` se parsea ordenada;
  escena malformada se descarta sin tirar el match; `scenes` vacío tras sanear cae
  a `scenePrompt`.
- *Planner*: idea-secuencia → N `PlanItemDraft` con mismo `sequenceId`, `sceneIndex`
  0..N-1, misma fecha/formato/aspectRatio/characterIds; `interleaveAndSchedule` no
  dispersa la secuencia; tope de 30 respeta escenas.
- *Server action* (`campaigns.test.ts`): `mergeSequenceAction` colapsa N→1 y rechaza
  si hay escenas generadas.
- *UI*: función de agrupado por `sequence_id` (sin render pesado).

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `supabase/migrations/035_campaign_sequences.sql` | nuevo: 3 columnas + índice |
| `lib/prompt-director/format-matcher.ts` | `scenes`/`sequenceLabel` en MatchSchema + system prompt |
| `lib/campaigns/planner.ts` | expansión de secuencia en `buildDirectedPlan` + scheduling unitario |
| `server-actions/campaigns.ts` | mapear campos en insert + `mergeSequenceAction` |
| `lib/schemas/campaigns.ts` | schema de input de `mergeSequenceAction` |
| `components/campaigns/CampaignStudioView.tsx` | agrupar y renderizar secuencias + "Unir en 1 clip" |
| tests | matcher, planner, server action, agrupado UI |
