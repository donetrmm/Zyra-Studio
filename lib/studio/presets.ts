import type { StudioAssetType } from '@/components/studio/types';

export type StudioPreset = {
  id: string; // 'builtin:...' para integrados; el uuid de la fila para guardados
  label: string;
  prompt: string;
  keepIdentical: boolean;
};

// Presets integrados por tipo de activo: los prompts que vivían en los botones
// de ángulo / quick-action de los editores (retirados en Fase 5). Al aplicarlos
// prellenan el prompt y activan "mantener idéntico" (el guard real lo agrega
// assembleStudioPrompt server-side, según el assetType de la sesión).
export const BUILTIN_PRESETS: Record<StudioAssetType, StudioPreset[]> = {
  product: [
    { id: 'builtin:product-3q', label: 'Vista 3/4', keepIdentical: true, prompt: 'Rotate the camera to show the exact same product from a three-quarter angle (turned about 45 degrees), so its front and one side are both visible at once. Do not alter or invent any label text.' },
    { id: 'builtin:product-90', label: 'Vista 90°', keepIdentical: true, prompt: 'Rotate the camera to show the exact same product from a direct side profile view (turned 90 degrees), so only its side is visible. Do not alter or invent any label text.' },
    { id: 'builtin:product-nobg', label: 'Quitar fondo', keepIdentical: true, prompt: 'Place the exact same product on a clean plain white background, removing the current background.' },
    { id: 'builtin:product-relight', label: 'Mejorar luz', keepIdentical: true, prompt: 'Relight the scene with even, soft, professional product lighting, neutral white balance and true-to-life colors with no warm yellow cast.' },
  ],
  location: [
    { id: 'builtin:loc-night', label: 'De noche', keepIdentical: true, prompt: 'Turn the scene to night time: dark sky, ambient and practical lights on, believable night lighting.' },
    { id: 'builtin:loc-warm', label: 'Luz más cálida', keepIdentical: true, prompt: 'Make the lighting warmer and softer, golden-hour feel, still believable for the place.' },
    { id: 'builtin:loc-clear', label: 'Despejar', keepIdentical: true, prompt: 'Remove any people, clutter and distracting loose objects, leaving the space clean and ready for a scene.' },
  ],
  character: [
    { id: 'builtin:char-3q', label: 'Vista 3/4', keepIdentical: true, prompt: 'Show the exact same person from a three-quarter view (about 45 degrees). Identical face, hairstyle, build, skin and clothing; only the camera angle changes.' },
    { id: 'builtin:char-90', label: 'Vista 90°', keepIdentical: true, prompt: 'Show the exact same person from a direct side profile view (90 degrees). Identical face, hairstyle, build, skin and clothing; only the camera angle changes.' },
  ],
  // Paneles: sin presets integrados en v1 (el compositor muestra solo los guardados).
  panel: [],
};

// Extrae un StudioPreset de una fila `presets` (params jsonb = unknown). Guarda:
// necesita un prompt string no vacío; keepIdentical opcional (los presets
// guardados hoy no lo persisten → default false). Devuelve null si no sirve.
export function parseUserPreset(row: { id: string; name: string; params: unknown }): StudioPreset | null {
  const params = row.params;
  if (!params || typeof params !== 'object') return null;
  const record = params as Record<string, unknown>;
  const prompt = record.prompt;
  if (typeof prompt !== 'string' || !prompt.trim()) return null;
  const keep = record.keepIdentical;
  return {
    id: row.id,
    label: row.name,
    prompt: prompt.trim(),
    keepIdentical: typeof keep === 'boolean' ? keep : false,
  };
}
