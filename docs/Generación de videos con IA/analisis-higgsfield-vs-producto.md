<!-- Generado por un workflow multiagente (Claude Opus 4.8): 8 lectores de codigo en paralelo + 34 principios extraidos del material de Higgsfield + analisis de brechas con verificacion adversarial contra el repo. Fuente: realistic-video-IA.md + skill seedance-shotlist-director + blog Higgsfield. NO se clonan modelos de Higgsfield; se destilan principios para adaptar a nuestro stack. Fecha: 2026-06-23. -->

# REPORTE: Workflow de video de Higgsfield vs 1to1 Studio

## Estado de implementacion (actualizado 2026-06-23)

**Tanda P0 IMPLEMENTADA y en `development`.** Los tres principios de direccion de mayor
impacto/menor costo ya viven en el codigo (no clonan Higgsfield; adaptados a nuestro
prompt-director determinista):

- **P14 Coreografia verbal** — el SYSTEM del matcher descompone verbos abstractos
  ("baila", "celebra", "se ve triste") en 2-4 micro-acciones SECUENCIALES; detector
  determinista `findUnexpandedActions` que AVISA (no reescribe). Archivos:
  `lib/prompt-director/acting.ts`, `format-matcher.ts`, `validators.ts`.
- **P20 Restraint consciente del registro** — directivas `ACTING_RESTRAINT_DIRECTION` /
  `ACTING_ENERGETIC_DIRECTION` inyectadas por los compilers de video (Seedance + Veo/Kling
  via `video-prose`) cuando hay rostro intencional y no hay emocion alta declarada.
  Archivos: `acting.ts`, `compilers/seedance.ts`, `compilers/video-prose.ts`.
- **P21 Camara motivada** — regla "camara estatica por defecto, nombra el motivo" en el
  matcher + warning determinista por tramo (2+ movimientos) en `validators.ts`.

Diseno y plan: `docs/superpowers/specs/2026-06-23-p0-direccion-actuacion-design.md` y
`docs/superpowers/plans/2026-06-23-p0-direccion-actuacion.md`. Commits `88a3b4a..872d769`
en `development`. Verificacion: `pnpm typecheck` limpio, suite 406/406.

**Smoke real (2026-06-23):** dos campanas de prueba confirmaron P14 (descomposicion de
"celebra" -> "steps back, smiles, claps twice" y "baila" -> "sways hips, bobs head"),
P21 (camara estatica, dolly motivado) y P20 (directiva inyectada en el prompt compilado
real). El smoke destapo y se corrigio un hueco: el lexicon de registros energeticos no
cubria vocabulario festivo en espanol ("alegre/festivo"); ahora `ENERGETIC_REGISTER_RE`
es un regex COMPARTIDO (exportado de `acting.ts`, usado por `audioDirection`) con terminos
es/en, cerrando tambien el riesgo de divergencia entre los dos detectores (commit
`872d769`). El render real esta bloqueado solo por saldo de AtlasCloud (402), no por codigo.

### Siguiente: tanda P1 (cablear datos al flujo de campana)

Con P0 cerrado, lo siguiente son los P1: ya requieren migraciones aditivas y/o UI, pero
reusan QStash/creditos/RLS existentes.

- **P14b Accion como intencion+resultado (S)** — directiva anti-biomecanica en el matcher
  + saneo determinista. Es el seguimiento mas barato de P0 (misma capa, effort S).
- **P16 Pista musical en campana (M)** — llenar `audioRefPath` en el flujo de campana
  (hoy `index.ts:71` lo fuerza a undefined); el smoke lo subrayo (escenas festivas piden
  cama musical). Feature latente de alto valor para coreografia/dance.
- **P12 Beats de actuacion (M)** y **P19 Densidad por ritmo (M)** — refinan el reparto de
  tiempo y la actuacion por tramo, en la misma linea de P0/P14.
- **P13 Bloqueo geo-espacial (M)** — posiciones relativas entre sujetos/entorno.
- **P11 Style block editable por pieza (M)** — re-estilizar una campana desde un punto.

Recomendacion de arranque: **P14b** (cierra la direccion de actuacion, effort S, misma
arquitectura ya validada) y en paralelo **P16** (alto valor, conecta con el hueco de audio
que el smoke ya mostro).

## 1. Resumen ejecutivo

Ya hacemos bien el nucleo del workflow profesional: pipeline de dos capas IDEA(LLM)/OFICIO(determinista), plan textual antes de quemar creditos (P09), prompts auto-contenidos por toma (P11b), antislop integrado (P28), pipeline por fases con gates (P29), reparto reutilizable (P06), hablante unico determinista (PD-15) y un plan persistente con IDs estables (P30). Donde el flujo Higgsfield nos saca ventaja es en la **direccion de actuacion** (coreografia verbal, restraint, motivacion de camara, bloqueo geo-espacial — todo cubierto solo a medias o ausente) y en la **fase de pre-produccion de assets** (hoja de producto multi-vista, variantes de estado, mapa de escala). Las 3 mayores oportunidades: (a) endurecer la direccion de actuacion/camara como redes deterministas baratas (P14/P20/P21, todo effort S); (b) cerrar el bucle de assets multi-vista y variantes de estado (P01/P05); (c) llevar la pista de audio y el bloqueo geo-espacial al flujo de campana (P16/P13), que hoy viven a medias o solo en generacion suelta.

## 2. Lo que ya tenemos (fortalezas)

**Direccion / prompt-craft**
- **P09 Plan textual antes del render** — desacople nativo: el matcher guioniza `scenes[]` y el planner los materializa en `campaign_items` sin tocar APIs (`lib/prompt-director/format-matcher.ts:111-151`, `lib/campaigns/planner.ts:317-371`).
- **P11b Prompt auto-contenido** — el compiler expande estilo/idioma/clausulas en CADA prompt, sin memoria asumida entre clips (`lib/prompt-director/compilers/seedance.ts:411-454`).
- **P28 Antislop** — lista determinista como paso final de todo compiler (`lib/prompt-director/antislop.ts:6-47`, `lib/prompt-director/index.ts:42-46`).

**Consistencia / assets**
- **P02 Fondo neutro para referencias** — forzado en hoja maestra generada y en producto-concepto (`components/cast/CastPage.tsx:152-158`, `components/creation/generate.ts:109-116`), y por instruccion al modelo en fotos subidas.
- **P06 Reparto por rol reutilizable** — Cast extremo a extremo: ficha + master/angle sheets + re-anclaje `@imageN` + pool con orden protagonista (`server-actions/cast.ts:15-22`, `supabase/migrations/031_campaign_characters.sql:7-20`).
- **P01 (consumo) Multi-vista de producto** — el compiler ya cita varias vistas del Brand Kit con fidelidad de forma/logo (`lib/prompt-director/inventory.ts:71-84`, `supabase/migrations/021_v2_brand_cast.sql:5-9`).

**Continuidad**
- **P17/P17b Carry-forward + prosa concreta** — `ChainParams` propaga identidad/producto/frame como metadato interno y emerge como prosa, sin etiquetas (`lib/campaigns/orchestrator.ts:316-380`).
- **P26 (nucleo) Presupuesto de coherencia** — una locacion por clip, complejidad acotada por duracion, hablante unico, presupuesto de angulos por tope de 9 imagenes (`lib/prompt-director/compilers/seedance.ts:56-59,189-214`).

**Workflow**
- **P29 Fases con gates** — PLAN→SAMPLE(tier fast)→FINAL(standard) con aprobacion de lote, preview de prompt y regen granular (`server-actions/campaigns.ts:357,1294,2180,1375`).
- **P08b (imagen) Router por fortaleza** — `selectImageModel` enruta FLUX/Nano por intent con reason auditable (`lib/router/model-selector.ts:64-198`).
- **P30 Plan persistente reentrante** — `campaign_items` con IDs estables; revisiones aplican delta preservando IDs (`server-actions/refine.ts:162-209`).

**Audio**
- **P16 (capacidad) Pista de audio como referencia** — el adapter Seedance acepta `reference_audios` y el compiler tiene la directiva `sync scene energy to its beats`, cableado en generacion suelta (`lib/providers/seedance.ts:297`, `lib/prompt-director/compilers/seedance.ts:247-250`).

## 3. Brechas priorizadas

| Principio | Status | Prioridad | Esfuerzo | Adaptacion (1 frase) |
|---|---|---|---|---|
| P14 Coreografia verbal (no etiquetas abstractas) | IMPLEMENTADO | P0 | M | Regla en el matcher para expandir verbos abstractos en micro-acciones + detector determinista de no-expansion. |
| P20 Restraint en actuacion por defecto | IMPLEMENTADO | P0 | S | Directiva determinista de contencion por defecto, condicional a emocion alta declarada. |
| P21 Movimientos de camara motivados | IMPLEMENTADO | P0 | S | Regla "camara estatica salvo beat que la justifique" + warning determinista por tramo. |
| P14b Accion como intencion+resultado (no biomecanica) | PARTIAL | P1 | S | Directiva anti-biomecanica + red de saneo que colapsa mecanica articular. |
| P12 Estructura CUT con beats de actuacion | PARTIAL | P1 | M | Beat de actuacion por tramo + bajar umbral de timeline a 5s + validador de plano/movimiento. |
| P16 Pista musical para sincronia de beat | PARTIAL | P1 | M | Llevar `audioRefPath` al flujo de campana, propagar la pista a todos los clips de la secuencia. |
| P13 Bloqueo geo-espacial | MISSING | P1 | M | Campo `blocking` por escena + seccion CRAFT determinista + re-inyeccion entre cortes. |
| P19 Densidad de cortes por ritmo dramatico | PARTIAL | P1 | M | `beatRole` (setup/reveal/action) que module clamp de duracion y densidad de corte. |
| P11 Style Prefix global editable por pieza | PARTIAL | P1 | M | `style_block` por campana/secuencia que el compiler antepone y cuya edicion re-estiliza todos los clips. |
| P01 Hoja de producto multi-vista generada | PARTIAL | P2 | M | Boton "Generar vista 3/4" via Nano Banana + `product_angle_image_ids` + warning con una sola foto. |
| P05 Variantes de estado pre-generadas | MISSING | P2 | M | Tabla `character_states` con variante horneada (mojado/sudado) que sustituye al master en esa escena. |
| P07 Locaciones en angulo 3/4 | PARTIAL | P2 | S | Cambiar `buildLocationPrompt` de "eye-level frontal" a placa 3/4 con lineas de fuga. |
| P10 Imagenes definitivas nombradas al LLM | PARTIAL | P2 | S | Adjuntar locaciones al matcher, usar nombre real del producto, subir cap de 4 a ~6-8. |
| P25 Vocabulario de camara nombrado (SnorriCam) | PARTIAL | P2 | S | Ampliar catalogo SHOTS con tecnicas firma + pasarlo al matcher como menu cerrado. |
| P03 Cara canonica unica en la hoja | PARTIAL | P2 | S | Verificacion de face_count via Gemini Flash + endurecer prompt FLUX a "un solo rostro". |
| P08 Animatic barato para elegir combo | PARTIAL | P2 | M | Tier "rehearsal" 480p/fast desechable que valida quimica cast-locacion en movimiento antes de produccion. |
| P08b Router de video por fortaleza | PARTIAL | P2 | M | `video-model-selector.ts` espejo del de imagen (Seedance/Veo/Kling por tarea). |
| P09 Shotlist unificado editable | PARTIAL | P2 | M | Vista "Shotlist" del Campaign Studio editable inline antes de Generar. |
| P22 Highlight reel / N candidatos en lote | PARTIAL | P2 | L | Productizar `batch_id`/`batch_kind` para N variaciones + trim/concat ffmpeg en worker. |
| P23 Montaje de inserts en un beat | PARTIAL | P2 | M | Modo inserts (3-4 angulos del mismo instante, sin encadenar) + stitching opcional. |
| P24 Override local de estilo por escena | PARTIAL | P2 | M | Slots estructurados `lightingOverride` + resolucion explicita override>base>default. |
| P26 (resto) Limite <=2 sujetos / anti-reflejos / on-camera | PARTIAL | P2 | S | Nudge <=2 humanos, clausula anti-espejos, regla "off-screen = inexistente". |
| P27 Setup/payoff narrativo | PARTIAL | P2 | M | `sceneRole` con elemento de contraste plantado en setup y re-citado en payoff. |
| P15 Mapa esquematico de escala/geografia | MISSING | P3 | M | Nuevo rol de referencia `scale_map` (planta top-down) re-anclado por clip. |
| P04 Compositado de ropa preservando piel | PARTIAL | P2 | M | Modo edicion de vestuario en Nano Banana (cambia prenda, preserva cara/piel). |

## 4. Top recomendaciones P0/P1

**P14 — Coreografia verbal (P0, M).** Hoy "baila"/"esta triste" pasan tal cual al modelo; la regla de EMOCION incluso empuja a NO listar senales (`format-matcher.ts:285`), lo opuesto a descomponer. Importa porque es la diferencia entre actuacion controlada y un promedio generico. Adaptacion: nudge en el SYSTEM del matcher para expandir verbos abstractos en 2-4 micro-acciones observables distribuidas en el timeline, mas una red determinista (`abstract-acting.ts`) que detecte verbos sin micro-accion y emita warning en `validators.ts`. Arquitectura: 100% texto en el prompt-director (matcher + red determinista pura), testeable sin API, no toca creditos/QStash/URLs; respeta fix-generator-not-output.

**P20 — Restraint por defecto (P0, S).** La contencion existe dispersa solo en la VOZ (`seedance.ts:38-39,308`); no hay directiva de contencion en la actuacion fisica, y nada modera un grito histrionico. Importa porque la sobre-actuacion delata la generacion. Adaptacion: constante `ACTING_RESTRAINT_DIRECTION` inyectada por defecto en clips con personaje en camara, condicional (se omite/invierte si el beat declara emocion alta por keywords), espejando el patron `SPEECH_DIRECTION`. Arquitectura: texto determinista en el compiler, mismo input→mismo output, sin tocar nada externo.

**P21 — Camara motivada (P0, S).** Hay control tecnico fuerte (un movimiento por toma, terminologia de cine) pero ninguna regla de que el movimiento responda a un beat dramatico; un dolly puede salir como decoracion. Adaptacion: directiva "camara estatica/casi-estatica por defecto; solo se mueve cuando el beat lo justifica, nombrando el motivo junto al movimiento" en el matcher, mas red determinista que colapse movimientos multiples y no inyecte movimiento por defecto en formatos no estilizados. Arquitectura: SYSTEM del matcher + validador determinista, patron PD-11/PD-15.

**P16 — Pista musical en campana (P1, M).** La capacidad existe extremo a extremo en generacion suelta, pero en el flujo principal de campana `audioRefPath` nunca se llena (`orchestrator.ts` no lo setea, `index.ts:71` lo fuerza a undefined), asi que `refAudios` siempre queda vacio. Importa porque la sincronia al beat (coreografia/dance) es imposible de transmitir por texto. Adaptacion: `audio_track_id` FK en `campaigns`, UI para subir/seleccionar pista, `directorContextFor` resuelve el path y lo propaga a TODOS los clips de la secuencia; gate por backend (solo Seedance/Atlas, Veo/Kling degradan a texto). Arquitectura: pista en bucket references firmada al encolar, async via QStash, creditos sin cambio (audio nativo gratis), RLS member; respeta tope de 12 refs via prioridad.

**P13 — Bloqueo geo-espacial (P1, M).** No existe ninguna nocion de posicion estatica relativa entre sujetos/entorno con distancias/orientaciones; los personajes pueden teletransportarse entre cortes. Adaptacion: campo opcional `blocking` por escena en el matcher (IDEA), seccion CRAFT determinista `Staging: <sujeto> at <posicion>, facing <orientacion>` en el compiler (OFICIO), y persistencia/re-inyeccion del blocking de la primera escena en las siguientes del mismo `sequence_id`. Arquitectura: texto puro en el prompt-director, sin migracion obligatoria (cabe en `scene_prompt`), separacion IDEA/OFICIO intacta.

**P12 — Estructura de beats de actuacion (P1, M).** El contrato del matcher pide plano+movimiento+emocion pero no micro-gesto/mirada/respiracion por tramo, y `toTimeline` solo dispara en clips >8s — la mayoria de escenas de secuencia (clampadas a 8s) quedan como prosa sin reparto de beats (`seedance.ts:400`). Adaptacion: exigir beat de actuacion por tramo en el matcher, bajar la guarda de timeline a `>=5 && beats>=2`, y red de saneo que inyecte encuadre por defecto si falta. Arquitectura: prompt-engineering + redes deterministas testeables sin API.

**P19 — Densidad por ritmo dramatico (P1, M).** El clamp uniforme de 8s recorta un reveal sostenido y la densidad de cortes es mecanica-temporal, no dramatica. Adaptacion: `beatRole` opcional del LLM que una red determinista mapea a politica de duracion/corte (reveal permite plano unico sostenido ~10-12s; action fuerza cortes cortos). El clamp deja de ser global. Arquitectura: idea estocastica + politica dura determinista, igual que PD-12/PD-15.

**P11 — Style Prefix por pieza (P1, M).** El estilo compartido es la fila `formats` (por categoria, no editable por campana); no hay un punto unico para re-estilizar una pieza. Nota: `applyBrandKit` ya implementa un style-prefix editable real pero solo en imagen suelta, no en video. Adaptacion: `campaigns.style_block` jsonb {camera,light,color,grain,physics}, panel editable, el compiler lo antepone verbatim, y editarlo re-encola los items via la maquinaria regen this-and-forward. Arquitectura: texto en capa determinista, regen via QStash, RLS heredada de campaigns, migracion aditiva documentada en spec.

## 5. Quick wins (effort S)

- **P07** Reescribir `buildLocationPrompt` de "Eye-level, cinematic wide framing" a placa en 3/4 con lineas de fuga (`components/locations/LocationsPage.tsx:149-156`). Un literal, cero migracion.
- **P10** Adjuntar locaciones al matcher, usar el nombre real del producto en vez de "producto", subir el cap de 4 imagenes a ~6-8 con prioridad producto>locacion>personajes (`server-actions/campaigns.ts:473-477`, `format-matcher.ts:398`).
- **P20** Inyectar `ACTING_RESTRAINT_DIRECTION` condicional en el compiler.
- **P21** Regla de motivacion de camara + colapso de movimientos multiples.
- **P14b** Directiva anti-biomecanica en el SYSTEM + saneo determinista.
- **P25** Ampliar `lib/shots/catalog.ts` con SnorriCam/dolly-zoom/whip-pan/bullet-time y pasar el catalogo al matcher como menu cerrado.
- **P03** Verificacion de `face_count` reusando el Gemini Flash de `describe-character.ts` + endurecer el prompt FLUX a "exactly one person, single face".
- **P26 (resto)** Nudge <=2 humanos, clausula anti-espejos/superficies especulares, regla "off-screen = inexistente".

## 6. No aplica / descartar

- **Herramientas atadas (Soul Cinema / AI Cast / GPT Image 2.0)** — no se clonan; el objetivo (casting por fortaleza, fondo neutro, multi-vista) ya lo cubrimos con FLUX + Nano Banana + Gemini Flash. Lo unico real que falta de P08b/P01/P06 es la sintesis de vistas y un router de video, no el catalogo de herramientas.
- **"15s fijo" de P18** — NOT_APPLICABLE literal: nuestros modelos son de duracion VARIABLE (Seedance 4-15s, Veo 4/6/8s, Kling 5-10s). El espiritu (llenar la ventana sin aire muerto + segmentar lo largo) ya esta cubierto via `durationS` por escena y el split por corte; solo falta el targeting "roomy" bidireccional y el auto-split por desborde de duracion (no la ventana fija).
- **Nomenclatura literal "CUT 1/2/3" y "3a/3b/3c"** — no se adopta como string; el equivalente arquitectonico real es `scene_index` bajo `sequence_id`. Adoptar el literal seria cosmetico y romperia el contrato del matcher.
- **Stitching/concat de MP4 final** — declarado fuera de alcance en specs/v2/09. Es legitimo dejarlo asi para el alcance actual: el encadenado ya hace que la union en cualquier editor se vea sin cortes. Solo se vuelve P2 si se prioriza el highlight reel (P22).

## 7. Cierre

Secuencia sugerida: **primero la tanda P0 de direccion (P14, P20, P21) mas los quick wins P14b/P07/P10/P25/P03** — son effort S, viven todos en el prompt-director determinista, no tocan schema ni arquitectura y elevan la calidad percibida de inmediato. **Segundo, los P1 que requieren cablear datos al flujo de campana** (P16 pista de audio, P13 bloqueo, P11 style_block, P12/P19 beats y ritmo) — ahi entran migraciones aditivas y UI, pero reusan QStash/creditos/RLS existentes. **Tercero, la pre-produccion de assets (P01 multi-vista, P05 variantes de estado) y el highlight reel (P22/P23)**, que son los de mayor esfuerzo y mejor van despues de que la direccion textual ya rinda.