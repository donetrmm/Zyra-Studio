// Lógica pura de la autoría del storyboard: selección de beats y compilación del
// prompt del panel (FLUX) y de su edición (Nano Banana). Sin DB ni red: la acción
// server (server-actions/storyboard.ts) hace el IO y llama a esta lógica.
import { compile, type CompileResult, type DirectorContext } from '@/lib/prompt-director';
import { describeCharacter, describeProduct, describeProductScale } from '@/lib/prompt-director/inventory';
import { creativeGuidelineClauses } from '@/lib/campaigns/guidelines';

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

// Compila el prompt FLUX del panel de un beat usando el contexto de campaña
// (producto/personaje/escena). El aspectRatio del beat manda la composición.
export function compilePanel(
  beat: PanelBeat,
  ctx: DirectorContext,
  fluxModelSlug: string,
  opts?: { isOpeningBeat?: boolean },
): CompileResult {
  return compile(
    { modelSlug: fluxModelSlug, scenePrompt: beat.scene_prompt, aspectRatio: beat.aspect_ratio ?? '9:16', isOpeningBeat: opts?.isOpeningBeat },
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

// ¿El creativo pide un look estilizado (no foto-real)? Mira el registro del formato
// y el scene_prompt — el "a menos que se indique lo contrario" del realismo humano.
export function isStylized(register: string, scenePrompt: string): boolean {
  return STYLIZED_RE.test(`${register} ${scenePrompt}`);
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
export function humanRealismDirective(ctx: DirectorContext, scenePrompt: string): string {
  if ((ctx.characters?.length ?? 0) === 0) return '';
  if (isStylized(ctx.format?.register ?? '', scenePrompt)) return '';
  return ' Render the people as real, photographed human beings — natural skin with pores and subtle texture, realistic eyes and hair, and lifelike light on the face — but keep their exact identity, face, body and wardrobe, and keep the product, exactly as in the reference images; change only the photographic realism of the rendering, never who the people are or what the product is.';
}

// Fidelidad del producto para paneles ENCADENADOS (edición conversacional). La
// cadena de Nano descarta las referencias externas en chat (refSlots=0 en el
// provider), así que el producto solo se ancla por TEXTO aquí: usa los atributos
// declarados (describeProduct con fidelity:false, sin apuntar a imágenes que no
// viajan) + instrucción de reproducir/conservar idéntico el contenido impreso entre
// tomas. Resuelve el caso "el panel ancla mostraba el producto envuelto o de lejos y
// el close-up lo inventa". Devuelve '' si no hay producto; empieza con espacio.
export function chainedProductFidelity(ctx: DirectorContext): string {
  if (!ctx.product) return '';
  const facts = describeProduct(ctx.product, { fidelity: false });
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

// Prompt del REFINADO conversacional de un panel (Nano Banana chat multi-turn).
// El refinado entra en chat real (hay thought_signature del panel previo), y ahí el
// provider descarta las referencias externas (refSlots=0). Por eso NO se usa el prompt
// de compilePanelEdit, cuyas cláusulas "as in the reference image" apuntan a imágenes
// que en el chat no viajan: el producto y el personaje se anclan por TEXTO
// (chainedProductFidelity/chainedCharacterFidelity, mismas anclas que la rama encadenada
// de regenerar). La escena y la locación las preserva el turno previo + "keep everything
// else the same". Devuelve el prompt completo (la instrucción es la edición a aplicar).
export function compileRefinePrompt(
  instruction: string,
  ctx: DirectorContext,
  opts?: { isOpeningBeat?: boolean },
): string {
  const lead = instruction.trim().replace(/\.?$/, '.');
  return `${lead} Keep everything else exactly the same — same composition, framing, lighting, colors and proportions.${chainedProductFidelity(ctx)}${chainedCharacterFidelity(ctx)}${describeProductScale(ctx.product)}${creativeGuidelineClauses(ctx.guidelines, { isOpeningBeat: opts?.isOpeningBeat })}`;
}

// Instruccion para extender la base 4:5 a 9:16: Nano recibe la base centrada en un
// lienzo 9:16 con bandas negras y rellena SOLO esas bandas continuando el fondo, sin
// sujetos. El centro NO se re-pega: sale de la misma generacion, por eso se exige
// mantenerlo identico y nitido (asi la continuacion empata sin costura). ASCII.
export const SAFE_AREA_EXTEND_PROMPT =
  'Continue the existing scene, background, lighting and perspective naturally into the empty top and bottom bands; keep the central area exactly unchanged and pixel-sharp - do not redraw, move, resize, recolor or soften it; do not place the product, any person, any text or any new object in the top and bottom bands - they are pure background extension only.';

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
