// Lógica pura de la autoría del storyboard: selección de beats y compilación del
// prompt del panel (FLUX) y de su edición (Nano Banana). Sin DB ni red: la acción
// server (server-actions/storyboard.ts) hace el IO y llama a esta lógica.
import { compile, type CompileResult, type DirectorContext } from '@/lib/prompt-director';

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
): CompileResult {
  return compile(
    { modelSlug: fluxModelSlug, scenePrompt: beat.scene_prompt, aspectRatio: beat.aspect_ratio ?? '9:16' },
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

// Directiva INTERNA de foto-realismo humano para paneles del storyboard CON
// personajes. Default ON; se omite cuando el creativo es estilizado (isStylized) o
// no hay personajes. Devuelve la cláusula con espacio inicial (lista para concatenar)
// o '' cuando no aplica. Solo paneles (decisión de alcance): el video la hereda vía
// el panel como first-frame/referencia y el compiler de video ya pide "ultra realistic".
export function humanRealismDirective(ctx: DirectorContext, scenePrompt: string): string {
  if ((ctx.characters?.length ?? 0) === 0) return '';
  if (isStylized(ctx.format?.register ?? '', scenePrompt)) return '';
  return ' The people must look like real, photographed human beings: natural skin with visible pores and subtle texture, realistic eyes with natural catchlights, natural hair, and lifelike body proportions and posture; avoid any plastic, waxy, airbrushed, doll-like, CGI or AI-generated look.';
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
