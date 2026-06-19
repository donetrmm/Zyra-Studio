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
