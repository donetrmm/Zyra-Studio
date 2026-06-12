// Une las escenas de una secuencia en un solo clip: concatena prompts y capa la
// duracion total a 15s (tope de un clip Seedance). Puro: testeable sin DB.
export function mergeScenes(
  rows: Array<{ scene_prompt: string; duration_s: number | null }>,
): { joinedPrompt: string; mergedDuration: number } {
  const joinedPrompt = rows.map((r) => r.scene_prompt).join('\n');
  const sum = rows.reduce((acc, r) => acc + (r.duration_s ?? 0), 0);
  return { joinedPrompt, mergedDuration: Math.min(Math.max(4, sum || 4), 15) };
}
