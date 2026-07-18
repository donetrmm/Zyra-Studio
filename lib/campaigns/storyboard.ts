// Lógica pura de la autoría del storyboard: selección de beats y compilación del
// prompt del panel (FLUX) y de su edición (Nano Banana). Sin DB ni red: la acción
// server (server-actions/storyboard.ts) hace el IO y llama a esta lógica.
import { compile, type CompileResult, type DirectorContext } from '@/lib/prompt-director';
import { describeCharacter, describeProduct, describeProductScale, describeProductWeight } from '@/lib/prompt-director/inventory';
import { creativeGuidelineClauses } from '@/lib/campaigns/guidelines';
import { getStyleProfile, WORLD_COHERENCE_CLAUSE, type VisualStyle } from '@/lib/prompt-director/style-profiles';
import { declaresHighEmotion, NATURAL_EXPRESSION_CLAUSE } from '@/lib/prompt-director/acting';

// Guard anti-texto del panel (SIEMPRE): el panel es imagen fija de un storyboard
// que luego se vuelve video — el texto/subtítulo lo maneja el pipeline aparte, y
// Nano tiende a quemar rótulos. Empieza con espacio (concatenable). Fuente única:
// la usan el panel fresco/encadenado (server-actions/storyboard.ts) y el refinado
// (compileRefinePrompt) — este último la perdía (auditoría 2026-07-04).
export const NO_TEXT_CLAUSE =
  ' Do not render any text, captions, speech bubbles, subtitles, labels or watermark in the image.';

// Guard de FRAME ÚNICO del panel (SIEMPRE, ambas ramas de generación): el
// scene_prompt del beat es guion de VIDEO y narra varias acciones en secuencia
// ("she then rotates… once the front faces…"); sin esta guarda el modelo de
// imagen resuelve la secuencia dibujando VARIAS viñetas/tomas dentro del mismo
// panel (bug 2026-07-07, beat del volteo en Anuncio #12). El panel es el
// FOTOGRAMA DE APERTURA del clip (buildCastR2VRefs lo cita como "the exact
// opening frame"), así que se congela el PRIMER instante de la acción; el resto
// de la descripción es lo que el video hará después, no contenido del panel.
export const SINGLE_FRAME_CLAUSE =
  ' Render exactly ONE single still frame — one instant frozen in time: the OPENING moment of the action described, its starting state before the action unfolds. Any later moments in the description happen NEXT in the video and must not appear in this image. Never compose a collage, grid, film strip, comic strip, storyboard sheet, split screen or multiple panels or frames inside one image.';

export type PanelBeat = {
  id: string;
  scene_prompt: string;
  aspect_ratio: string | null;
  storyboard_image_id: string | null;
};

// Beats que aún no tienen panel — los que "Generar storyboard" debe generar.
export function beatsNeedingPanel(beats: PanelBeat[]): PanelBeat[] {
  return beats.filter((b) => b.storyboard_image_id == null);
}

// El scene_prompt del planner es guion de VIDEO: puede traer líneas de diálogo
// (`Dialogue: "..."`) para el lip-sync. En un PANEL (imagen fija) ese texto no
// tiene rol visual y Nano tiende a QUEMARLO como subtítulo/caption al pie de la
// imagen pese al noText (bug confirmado 2026-07-02 con las bases 4:5 en storage:
// el diálogo del beat aparecía rotulado, y el gate anti-texto del expand fallaba
// determinista al reintentar con la MISMA base). Quita TODOS los segmentos
// (timelines traen varios), en inglés y español, comillas rectas o curvas; la
// acción visual queda intacta. Solo paneles: el video conserva el diálogo.
export function stripDialogueForPanel(scenePrompt: string): string {
  return (scenePrompt ?? '')
    .replace(/\s*(?:dialogue|di[aá]logo)\s*:\s*["“][^"“”]*["”]\s*\.?/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Compila el prompt FLUX del panel de un beat usando el contexto de campaña
// (producto/personaje/escena). El aspectRatio del beat manda la composición.
// El diálogo del beat se elimina aquí (stripDialogueForPanel): es lip-sync de
// video, no contenido visual del panel.
export function compilePanel(
  beat: PanelBeat,
  ctx: DirectorContext,
  fluxModelSlug: string,
  opts?: { isOpeningBeat?: boolean },
): CompileResult {
  return compile(
    { modelSlug: fluxModelSlug, scenePrompt: stripDialogueForPanel(beat.scene_prompt), aspectRatio: beat.aspect_ratio ?? '9:16', isOpeningBeat: opts?.isOpeningBeat },
    ctx,
  );
}

// Términos INEQUÍVOCOS de estilo de render no foto-real. OJO dominio: el producto
// de este proyecto son cuadros/fotos impresas, así que NO se incluyen sustantivos
// que describen el producto (painting/pintura/cuadro/dibujo/drawing/illustration/
// ilustra/print/impreso) — matchearlos apagaría el realismo justo en beats de foto
// real. Solo estilos de render claros: cartoon, anime, 3d/cgi, surreal, animado…
const STYLIZED_RE =
  /\b(cartoon\w*|toon|anime|manga|comic|c[oó]mic|cel[- ]?shad\w*|claymation|stop[- ]?motion|pixel\s*art|low[- ]?poly|voxel|cgi|3d|render(ed|ing)?|surreal\w*|surrealist\w*|dreamlike|on[ií]rico|abstract\w*|abstracto|stylized|stylised|estiliz\w*|animated|animation|animaci[oó]n|animado)\b/i;

// ¿El creativo pide un look estilizado (no foto-real)? Perfil declarado manda
// (animado/fantasia SIEMPRE estilizados; custom añade su texto a la regex);
// sin perfil, la regex sobre registro + scene_prompt (compatibilidad).
export function isStylized(
  register: string,
  scenePrompt: string,
  style?: { slug: VisualStyle; custom?: string },
): boolean {
  if (style?.slug === 'animado' || style?.slug === 'fantasia') return true;
  const customText = style?.slug === 'custom' ? (style.custom ?? '') : '';
  return STYLIZED_RE.test(`${register} ${scenePrompt} ${customText}`);
}

// Directiva INTERNA de foto-realismo humano para el panel FRESCO del storyboard CON
// personajes. Default ON; se omite cuando el creativo es estilizado (isStylized) o
// no hay personajes. Devuelve la cláusula con espacio inicial (lista para concatenar)
// o '' cuando no aplica. Solo paneles (decisión de alcance): el video la hereda vía
// el panel como first-frame/referencia y el compiler de video ya pide "ultra realistic".
//
// CRÍTICO (bug fijo): la cláusula está SUBORDINADA a la fidelidad — prohíbe cambiar
// identidad/cara/cuerpo/vestuario y el producto, y solo permite mejorar el realismo
// fotográfico del render. Una versión anterior sin esta guardia (y aplicada también
// a la edición encadenada) hacía que el modelo re-renderizara al sujeto: la cara
// derivaba y el producto cambiaba por completo. Por eso NO se usa en la rama
// encadenada (esa edita el panel anterior, que ya es foto-real, y debe preservar).
//
// Con perfil declarado no-realista (incluido custom con texto) la directiva se
// omite — el perfil manda, incluso si el texto custom no matchea STYLIZED_RE
// (ej. "acuarela suave, colores pastel": vocabulario pictórico deliberadamente
// fuera de la regex, ver isStylized).
export function humanRealismDirective(ctx: DirectorContext, scenePrompt: string): string {
  if ((ctx.characters?.length ?? 0) === 0) return '';
  const profile = getStyleProfile(ctx.style?.slug, ctx.style?.custom);
  if (!profile.photoreal) return '';
  if (isStylized(ctx.format?.register ?? '', scenePrompt, ctx.style)) return '';
  return ' Render the people as real, photographed human beings — natural skin with pores and subtle texture, realistic eyes and hair, and lifelike light on the face — but keep their exact identity, face, body and wardrobe, and keep the product, exactly as in the reference images; change only the photographic realism of the rendering, never who the people are or what the product is.';
}

// Expresión contenida para el panel FRESCO (feedback 2026-07-04): mismas guardas
// que humanRealismDirective (personajes presentes, perfil realista, no estilizado)
// más el respeto a la emoción grande declarada (igual que el acting del video:
// si el guion pide llanto/grito, no se contiene). Solo panel fresco — en ramas
// de edición cualquier cláusula que toque la cara arriesga drift de identidad.
export function expressionDirective(ctx: DirectorContext, scenePrompt: string): string {
  if ((ctx.characters?.length ?? 0) === 0) return '';
  const profile = getStyleProfile(ctx.style?.slug, ctx.style?.custom);
  if (!profile.photoreal) return '';
  if (isStylized(ctx.format?.register ?? '', scenePrompt, ctx.style)) return '';
  if (declaresHighEmotion(scenePrompt)) return '';
  return NATURAL_EXPRESSION_CLAUSE;
}

// Estilo/realismo del ENTORNO para el panel FRESCO + coherencia física. A
// diferencia de humanRealismDirective (solo personas, con guarda de identidad),
// aplica también a paneles SIN personajes: los materiales, la luz y el desorden
// del entorno delatan el look de render igual que la piel. Igual de subordinada
// a la fidelidad: pide calidad fotográfica del render, nunca re-imaginar
// producto/escena. Se omite en creativos estilizados (isStylized). SOLO panel
// fresco — en ramas de edición el re-render está vetado (ver humanRealismDirective).
export function sceneStyleDirective(ctx: DirectorContext, scenePrompt: string): string {
  const profile = getStyleProfile(ctx.style?.slug, ctx.style?.custom);
  // Con perfil foto-real (o ausente), un beat individual estilizado por texto
  // apaga la directiva (regex de compatibilidad); con perfil declarado
  // no-realista, el perfil manda y emite su propio bloque.
  if (profile.photoreal && isStylized(ctx.format?.register ?? '', scenePrompt, ctx.style)) {
    return '';
  }
  return `${profile.panel}${profile.groundedPhysics ? WORLD_COHERENCE_CLAUSE : ''}`;
}

// Física SOLA, para las ramas de EDICIÓN (panel encadenado y refinado sandwich):
// ahí las cláusulas de re-render causan drift (bug documentado arriba), pero
// anclar objetos es compatible con preservar — restringe DÓNDE queda lo que la
// edición mueve, no CÓMO se re-renderiza lo que no toca. Gatea por perfil de
// campaña (fantasía la apaga).
export function physicsClause(ctx: DirectorContext): string {
  const profile = getStyleProfile(ctx.style?.slug, ctx.style?.custom);
  return profile.groundedPhysics ? WORLD_COHERENCE_CLAUSE : '';
}

// Fidelidad del producto para paneles ENCADENADOS (edición conversacional). La
// cadena de Nano descarta las referencias externas en chat (refSlots=0 en el
// provider), así que el producto solo se ancla por TEXTO aquí: usa los atributos
// declarados (describeProduct con fidelity:false, sin apuntar a imágenes que no
// viajan) + instrucción de reproducir/conservar idéntico el contenido impreso entre
// tomas. Resuelve el caso "el panel ancla mostraba el producto envuelto o de lejos y
// el close-up lo inventa". Devuelve '' si no hay producto; empieza con espacio.
export function chainedProductFidelity(ctx: DirectorContext): string {
  const product = ctx.products?.[0];
  if (!product) return '';
  const facts = describeProduct(product, { fidelity: false });
  return ` ${facts} Reproduce the product's printed image and design exactly as described, and keep it identical in every shot; do not invent, restyle or change what is printed on it.`;
}

// Fidelidad del PERSONAJE para paneles ENCADENADOS (edición conversacional).
// Análogo a chainedProductFidelity: la cadena de Nano descarta las referencias
// externas en chat (refSlots=0 en el provider), así que la identidad del cast solo
// se ancla por TEXTO aquí. Usa la descripción age-blind de cada personaje
// (describeCharacter con fidelity:false, sin apuntar a imágenes que no viajan) +
// instrucción de PRESERVAR idéntico entre tomas.
//
// CRÍTICO (mismo gotcha que humanRealismDirective): debe ser SOLO de preservación
// ("conserva idéntico, no redibujar"), NUNCA un re-render ("render as real / mejora
// el realismo"). Una cláusula de re-render en la rama encadenada hacía derivar la
// cara y cambiar la identidad. Por eso aquí no se pide renderizar nada, solo mantener.
// Devuelve '' si no hay personajes; empieza con espacio (listo para concatenar).
export function chainedCharacterFidelity(ctx: DirectorContext): string {
  if (!ctx.characters?.length) return '';
  const facts = ctx.characters
    .map((c) => describeCharacter(c, { fidelity: false }).text)
    .join(' ');
  return ` ${facts} Keep each person's exact face, hair, build, skin and wardrobe identical to the previous shot; do not redraw, re-age, restyle or change who they are.`;
}

// Refs que se adjuntan al TURNO DE CHAT (regenerar encadenado / refinar) según
// los toggles "mantener idéntico" del beat. En chat las referencias externas no
// viajan solas (refSlots=0): estos toggles son la única vía de meter la ficha
// del producto, la hoja del cast o la imagen de la locación (rol environment).
// Orden estable producto → personaje → locación (los pointers del prompt citan
// en ese orden). Puro; ambas actions (regenerar y refinar) lo comparten.
export function chatRefPathsFor(
  refs: { storagePath: string; role: string }[],
  toggles: { product: boolean; character: boolean; location: boolean },
): string[] {
  return [
    ...(toggles.product ? refs.filter((r) => r.role === 'product').map((r) => r.storagePath) : []),
    ...(toggles.character ? refs.filter((r) => r.role === 'character').map((r) => r.storagePath) : []),
    ...(toggles.location ? refs.filter((r) => r.role === 'environment').map((r) => r.storagePath) : []),
  ];
}

// Prompt del REFINADO conversacional de un panel (Nano Banana chat multi-turn).
// El refinado entra en chat real (hay thought_signature del panel previo), y ahí el
// provider descarta las referencias externas (refSlots=0). Por eso NO se usa el prompt
// de compilePanelEdit, cuyas cláusulas "as in the reference image" apuntan a imágenes
// que en el chat no viajan: el producto y el personaje se anclan por TEXTO
// (chainedProductFidelity/chainedCharacterFidelity, mismas anclas que la rama encadenada
// de regenerar). La identidad de producto y personaje ya la fijan esas cláusulas, así que
// aquí NO se pide "misma composición/encuadre" (eso contradecía y bloqueaba las ediciones
// compositivas como "pon el cuadro en la pared"): se preserva la continuidad de escena
// (locación, luz, color) pero se permite recomponer lo necesario para aplicar la edición.
// PRECEDENCIA: la instrucción del refinado viene de un HUMANO con intención — a
// diferencia del texto del planner (que las anclas guardan contra contradicciones
// accidentales), aquí la edición pedida MANDA, incluso sobre el producto ("haz menos
// grueso el canvas"): las anclas aplican solo a lo que la edición no toca.
// Devuelve el prompt completo (la instrucción es la edición a aplicar).
export function compileRefinePrompt(
  instruction: string,
  ctx: DirectorContext,
  opts?: { isOpeningBeat?: boolean; extraClauses?: string; strong?: boolean },
): string {
  const lead = instruction.trim().replace(/\.?$/, '.');
  // MODO FUERTE (single-turn): prompt MINIMO dominado por la edición. La imagen
  // adjunta ya fija identidad, escala y escena — las anclas de texto solo
  // compiten contra la edición (con ellas, "haz el borde más delgado" salía con
  // un delta imperceptible). Se exige además un cambio VISIBLE: el modo de
  // edición de estos modelos tiende al ajuste mínimo.
  if (opts?.strong) {
    return `${lead} Change only what this edit asks, and render the change clearly and unmistakably — a subtle, barely visible adjustment is a failure. Keep everything else (people, faces, wardrobe, product, scene, lighting, framing) exactly as in the attached image.${NO_TEXT_CLAUSE}${opts?.extraClauses ?? ''} FINAL INSTRUCTION — this is the edit to apply: ${lead}`;
  }
  // Sandwich: la edición abre Y cierra el prompt. El modelo pesa mucho el final;
  // con la edición solo al inicio, las anclas de fidelidad (que van después)
  // dominaban y ediciones legítimas del producto salían ignoradas. extraClauses
  // (punteros a refs adjuntas en chat) va ANTES del cierre para no taparlo.
  //
  // describeProductScale({ staging: false }): la edición preserva composición
  // ("adjust composition and framing only as needed") — una instrucción ACTIVA
  // de re-encuadre (cámara atrás, staging por tipo) compite contra esa preservación
  // y causa drift. El peso y la escala sí anclan aquí (identidad física del
  // producto); el staging/encuadre no entra a esta rama. La rama ENCADENADA en
  // server-actions/storyboard.ts sí lo mantiene: ahí re-encuadrar es el propósito,
  // y el carve-out de close-up/detail shot protege los beats que no deben moverse.
  return `${lead} Apply this edit faithfully, even when it changes the product's or a character's appearance (size, thickness, frame, finish, printed content, wardrobe): the requested edit ALWAYS takes precedence over the consistency clauses below, which apply only to whatever the edit does not touch. Keep the rest of the scene consistent with the previous shot (same location, lighting and color palette); adjust composition and framing only as needed for the change to look natural.${chainedProductFidelity(ctx)}${chainedCharacterFidelity(ctx)}${describeProductScale(ctx.products?.[0], { staging: false })}${describeProductWeight(ctx.products?.[0])}${physicsClause(ctx)}${creativeGuidelineClauses(ctx.guidelines, { isOpeningBeat: opts?.isOpeningBeat })}${NO_TEXT_CLAUSE}${opts?.extraClauses ?? ''} FINAL INSTRUCTION — this is the edit to apply, and it overrides any clause above that conflicts with it: ${lead}`;
}

// Compila la edición Nano Banana de un panel: la instrucción es el scenePrompt.
// La imagen base y el turno previo los inyecta la acción server (IO), no aquí.
export function compilePanelEdit(
  instruction: string,
  aspectRatio: string | null,
  ctx: DirectorContext,
  nanoModelSlug: string,
): CompileResult {
  return compile(
    { modelSlug: nanoModelSlug, scenePrompt: instruction, aspectRatio: aspectRatio ?? '9:16' },
    ctx,
  );
}
