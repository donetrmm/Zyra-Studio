# Errores de generación de video — bitácora de correcciones

Registro de los problemas que hemos detectado y atacado en la **generación de video**
(Seedance 2.0 vía AtlasCloud, modo campañas y modo storyboard). Cada entrada: síntoma
observado, causa raíz, fix aplicado y estado. Útil como referencia para no repetir
diagnósticos y para entender por qué el pipeline está como está.

> Fuente: memoria del proyecto + sesiones de trabajo (jun 2026). Verifica contra el
> código actual antes de citar líneas; los commits son la fuente dura.

---

## 1. Referencias y consistencia (cast / producto)

### 1.1 El cast pierde consistencia durante la acción
- **Síntoma:** el video partía solo del panel (image2video, panel = primer fotograma);
  el personaje se mantenía al inicio pero su cara derivaba durante la acción.
- **Causa:** sin una referencia del cast que re-ancle la identidad a lo largo del clip.
- **Intento 1 (fallido):** mandar la hoja maestra del cast como `reference_image` junto
  al panel (image2video + refs). **Atlas lo RECHAZA** con `400`: *"first/last frame
  content cannot be mixed with reference media content"*. No se puede mezclar fotograma
  inicial + referencias en Atlas.
- **Fix (fallback R2V):** los beats con cast pasan a `reference2video` (cast `@image1..N`
  + panel como `@image{N+1}`, **sin** first_frame). El cast re-ancla la identidad todo el
  clip; el panel ancla composición/apertura. Commits `8414a45..f5cc8cc`.
- **Estado:** funcionando. Tradeoff: el panel deja de ser el fotograma 0 *exacto* y pasa
  a ser referencia fuerte.

### 1.2 El producto (cuadro) deriva en clips encadenados/R2V
- **Síntoma:** en el clip 2 el producto cambiaba; perdía consistencia.
- **Causa raíz (evidencia MCP):** R2V mandaba el cast pero **NO el producto como
  referencia dedicada** — el producto solo viajaba *dentro* del panel (referencia blanda).
  `onlyCharacterRefs` lo quita del contexto del compile.
- **Fix:** `buildCastR2VRefs` ahora suma el producto como referencia dedicada
  (orden `cast @image1..N` + `producto` + `panel`), tomado de `baseDirCtx.product`
  (antes de `onlyCharacterRefs`), citado explícitamente. Commit `7b8977c`.
- **Estado:** corregido; pendiente de confirmar en smoke del usuario.

### 1.3 El close-up de producto "pega" el cast literal y no anima
- **Síntoma:** el último clip "no parecía video": mostraba la imagen del storyboard y
  luego metía al personaje del cast literal, como un collage estático.
- **Causa:** ese beat (close-up del cuadro) llevaba las hojas maestras del cast como
  **personas vivas**, pero ahí la gente está *impresa en el canvas*, no actuando → el
  modelo no sabe animar y compone un collage.
- **Fix:** `beatNamesCast(scenePrompt, names)` — el cast solo va como referencia viva si
  el `scene_prompt` **nombra** al personaje (token ≥3, word-boundary). Beats sin cast
  nombrado (close-up de producto) → **image2video** (panel = primer fotograma exacto,
  lock total + movimiento real). Commit `7b8977c`.
- **Estado:** corregido; pendiente smoke.

### 1.4 El producto se revela cuando debería estar volteado (toma de reacción)
- **Síntoma:** en el clip 2 (Juanita reacciona, el cuadro de espaldas) el video empezaba
  con el cuadro de espaldas y a media toma **revelaba el impreso** a cámara.
- **Causa (doble):**
  1. La cita de la referencia de producto decía *"reproduce its printed image exactly and
     keep it identical **throughout the shot**"* → forzaba el impreso visible toda la toma.
  2. El propio `scene_prompt` era **contradictorio**: *"looks at the back of the canvas"* +
     *"she sees the family portrait on the canvas (from her POV only)"* → el modelo mostraba
     ambas.
- **Fix:**
  - Cita de producto **condicional a visibilidad** y subordinada al encuadre: *"whenever
    the product is visible… follow the shot's framing for whether it faces the camera or is
    turned away; do not reveal the print unless the shot shows it"*. Commit `962465a`.
  - Reescritura del `scene_prompt` del clip 2 (vía MCP) para que sea inequívoco (cuadro de
    espaldas todo el tiempo, sin reveal).
- **Estado:** corregido. **Hueco de raíz:** el `scene_prompt` (acción/encuadre del video)
  **no es editable desde la UI** (solo se puede refinar el panel y el diálogo) → por eso
  refinar el panel no cambiaba la deriva del video. Opción futura: editor de scene_prompt
  por beat.

---

## 2. Audio y voz

### 2.1 Voz apresurada / robótica por diálogo que no cabe
- **Síntoma:** la voz salía apresurada y se oía robótica.
- **Causa:** el diálogo **no cabe** en los segundos del clip (es ~2.5 palabras/s; p.ej.
  14 palabras en 5s) → Seedance acelera. **No** es calidad de voz.
- **Fix:** sección de audio por beat en el storyboard (editar diálogo + duración) con un
  medidor de holgura (muy ajustado / justo / holgado) usando `lib/campaigns/speech-fit.ts`.
  Ritmo implícito por holgura; sin migración (el diálogo vive en `scene_prompt`).
- **Estado:** implementado.

### 2.2 Voz robótica en un VOICEOVER (sin hablante en cámara)
- **Síntoma:** el clip 3 (close-up de producto con *Voiceover*) salía robótico, aun con
  el ritmo holgado.
- **Causa raíz:** `hasSpokenDialogue` matchea el entrecomillado, así que un voiceover
  recibía `SPEECH_DIRECTION` (lip-sync **on-camera**, que literalmente dice *"not voice-over
  narration"*). El modelo intentaba "sincronizar" una cara inexistente sobre un inserto de
  producto → voz rara.
- **Fix:** `isVoiceover(text)` separa narración en off de habla en cámara;
  `speaker (lip-sync) = hasSpokenDialogue && !voiceover`; un VO recibe `VOICEOVER_DIRECTION`
  (voz natural en off, sin lip-sync) y conserva idioma/acento/cadencia. Commit `8ba286f`.
- **Estado:** corregido.

### 2.3 Palabras mal pronunciadas
- **Síntoma:** el modelo masticaba/equivocaba palabras: `imprimiste`, `regalado`, y la
  marca `Prolienzo`.
- **Causa:** verbos **paroxítonos sin tilde** (la tónica va en la penúltima pero el modelo
  la coloca mal); y un nombre de marca cuya acentuación el modelo no infiere.
- **Fix manual (validado):** reescribir la palabra con la **tónica marcada** en el diálogo
  (`imprimíste`, `regaládo`). El diálogo es guion hablado puro (no hay texto en pantalla),
  así que se puede respelar sin penalización visual.
- **Fix automatizado:** `lib/prompt-director/pronunciation.ts` —
  `PRONUNCIATION_RESPELLINGS` (mapa **curado** palabra→respelling) + `applyRespellings`,
  aplicado al compilar el video (no toca el texto guardado). NO se usa una regla general
  porque acentuar todas las paroxítonas sobre-aplica y rompe palabras buenas. Commits
  `4bf5bc2` (motor + imprimiste/regalado), `9e4a7a1` (`Prolienzo` → `Prólienzo`,
  PRO-lien-zo, esdrújula).
- **Estado:** automatizado. **Extender:** una línea en el mapa por cada palabra nueva que
  falle (clave = palabra sin tilde, valor = respelling con la tónica marcada).
- **Articulación general:** además se añadió a `DIALOGUE_LANGUAGE` (es/en) una directiva de
  articular cada palabra completa, valor pleno a cada sílaba (commit `74ece4e`).

---

## 3. Composición y dirección de escena

### 3.1 Lágrimas falsas
- **Síntoma:** en el clip 2 (Juanita emocionada) las lágrimas se veían muy falsas.
- **Causa:** señales emocionales en el `scene_prompt` (*eyes widen / hand over mouth / in
  surprise / gasp*) hacían que el modelo añadiera llanto; los modelos de video renderizan
  lágrimas mal por defecto.
- **Fix:** reescribir el `scene_prompt` con la emoción **inequívoca** elegida por el usuario
  (sorpresa con mano a la boca → sonrisa grande, **sin lágrimas**), aplicado vía MCP.
- **Estado:** corregido a nivel scene_prompt; las lágrimas realistas siguen siendo
  empíricas si alguna vez se quieren (dirigir sutiles: "ojos vidriosos, una lágrima que no
  escurre").

### 3.2 Clips independientes no se pueden montar (sin entrada/salida)
- **Síntoma:** al no estar encadenados, los clips arrancan/terminan distinto → cortes feos
  en postproducción.
- **Fix:** `STORYBOARD_EDIT_HANDLES` — directiva que pide **abrir/cerrar en fotograma
  estable** (abrir en el fotograma inicial sostenido, cerrar casi quieto) → puntos de corte
  limpios. Se añade al prompt de todo clip de storyboard. Commit `7b8977c`.
- **Estado:** implementado; pendiente smoke.

---

## 4. Encadenado y degradación acumulativa

### 4.1 "El siguiente clip se ve más oscuro / más expuesto"
- **Síntoma reportado:** clips encadenados que parecían oscurecerse o saturarse, peor hacia
  el final.
- **Diagnóstico (tras MIRAR los fotogramas, no solo métricas):** no era brillo/exposición
  (el promedio de cuadro completo lo escondía: la pared gris domina). Era **degradación
  acumulativa de la calidad del SUJETO (generation loss)**: las pieles acumulan
  pecas/manchas/contraste/saturación al re-generar R2V desde el fotograma anterior una y
  otra vez. El re-anclaje de producto/personaje preserva identidad pero NO frena la
  acumulación de textura.
- **Fix elegido (raíz):** feature **Locaciones** — una secuencia con `location_id` se
  genera **SIN encadenar** (cada escena independiente, re-anclando producto/personajes/
  locación) → cero herencia de frame → cero degradación. Implementado (migración 041, base).
- **Estado:** base implementada; el **modo storyboard** (paneles diseñados como base de
  cada clip) es la otra cara de la misma idea: cada clip parte de un panel limpio, no de un
  frame heredado.
- **Herramienta de diagnóstico:** `scripts/measure-chain-luma.mjs`
  (`pnpm measure:chain-luma`, soporta `--campaign-name`, `--dump` para volcar fotogramas).
- **Lección:** medir antes de asumir; y cuando la métrica no cuadra con la percepción,
  **mirar los píxeles** — el promedio de cuadro completo escondía la degradación localizada
  en las caras.

---

## 5. Provider / Atlas (restricciones del backend)

Hechos del backend que han causado o condicionado errores (`lib/providers/seedance.ts`):

- **El slug DEBE coincidir con la operación:** `bytedance/seedance-2.0/{text,image,
  reference}-to-video`. Bug atrapado en review: el insert ponía `operation: image2video`
  pero `model_id` seguía siendo un slug `reference-to-video` → Atlas ruteaba mal y el panel
  se ignoraba como first_frame (en ModelArk "funcionaba" por casualidad). Fix:
  `toImage2VideoSlug` reescribe el slug (mismo tier/precio).
- **Atlas NO permite first_frame + reference media** (ver 1.1). Por eso el cast va por R2V.
- **Atlas no expone el tier `fast`** en el id; `…/fast/…` da `400 not found`. El adapter
  mapea `/fast/` → estándar. (Los drafts corren en standard.)
- **Backend dual:** ModelArk (default, pero el modelo aún no activado en la cuenta) vs
  AtlasCloud (`SEEDANCE_PROVIDER=atlas`, el que se usa). El `model` del request es el slug
  interno tal cual.

---

## 6. NO era la generación (falsos positivos)

### 6.1 Video "trabado" / entrecortado
- **Síntoma:** los videos de campaña se veían trabados en la app.
- **Causa real:** **el reproductor**, no la generación. El fuente en la consola de Atlas se
  ve fluido. El clip se reproduce en un modal con `backdrop-blur` + recorte
  (`overflow-hidden` + rounded) → el compositor del navegador recalcula cada frame →
  tartamudeo. El creador rápido (inline, sin modal) se ve fluido.
- **Fix:** quitar `backdrop-blur` del overlay del Dialog + promover el `<video>` a su capa
  (`translateZ(0)`).
- **Red herrings descartados:** prompt del director, duración, split en secuencias, tier
  `fast`, resolución 720p, densidad del prompt.
- **Lección:** ante "video trabado", PRIMERO comparar el archivo **fuente** (consola del
  proveedor) vs la reproducción en la app. Si el fuente está bien, es la UI/CSS/compositor.

---

## Lecciones transversales

1. **Mirar el `scene_prompt` almacenado antes de tocar el compiler.** Varias veces el video
   "desobedecía" porque el scene_prompt traía una instrucción contradictoria (reveal del
   producto, señales de llanto). Ningún cambio de código arregla una instrucción que pide
   explícitamente lo que no quieres.
2. **Separar capas al diagnosticar:** panel (imagen base) vs scene_prompt (dirige el
   movimiento) vs referencias (cast/producto) vs provider (Atlas). El usuario podía refinar
   el panel pero no el scene_prompt → quedaba atascado.
3. **Distinguir conceptos de voz:** `voiced` (idioma/cadencia) ≠ `speaker` (lip-sync
   on-camera) ≠ `voiceover` (voz en off). Mezclarlos producía voz robótica.
4. **Las referencias correctas dependen de la toma:** cast solo si actúa; producto solo si
   es visible; panel como first_frame cuando se puede (lock + movimiento real).
5. **Medir/mirar antes de asumir.** Las métricas de cuadro completo escondían degradación
   localizada; el "trabado" era CSS, no el modelo.
