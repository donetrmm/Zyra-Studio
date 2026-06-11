// Destilación de plantillas vivas (specs/v2/04 tarea 4) — la parte PURA,
// testeable sin DB. Un creativo ganador se convierte en plantilla: estructura,
// cámara, ritmo y estilo quedan fijos (el video ganador es la referencia
// @Video1); producto, escena y personaje son slots rotables.

export type TemplateFixedParams = {
  modelSlug: string;
  durationS: number;
  aspectRatio: string;
  resolution: string;
  audio: boolean;
  // Path del video ganador COPIADO al bucket references (el handler solo
  // firma ese bucket; outputs tiene policies distintas).
  templateVideoPath: string;
};

export type TemplateSlots = {
  scenePrompt: string;       // la acción del ganador — se conserva en la serie
  scene: string | null;      // slot rotable
  characterId: string | null; // slot rotable
  productName: string;
};

export function buildTemplateParams(input: {
  modelSlug: string;
  durationS: number | null;
  aspectRatio: string | null;
  resolution: string | null;
  audio: boolean;
  templateVideoPath: string;
}): TemplateFixedParams {
  return {
    modelSlug: input.modelSlug,
    durationS: input.durationS ?? 8,
    aspectRatio: input.aspectRatio ?? '9:16',
    resolution: input.resolution ?? '720p',
    audio: input.audio,
    templateVideoPath: input.templateVideoPath,
  };
}

export type SeriesItemDraft = {
  formatId: string | null;
  templateId: string;
  modelSlug: string;
  durationS: number;
  aspectRatio: string;
  scene: string;
  audio: boolean;
  characterId: string | null;
  scenePrompt: string;
  scheduledDate: string; // YYYY-MM-DD
};

// Genera los items de una serie rotando los slots. La escena original del
// ganador se excluye de la rotación (la serie debe VARIAR, no repetir).
export function buildSeries(input: {
  templateId: string;
  formatId: string | null;
  fixed: TemplateFixedParams;
  slots: TemplateSlots;
  count: number;
  scenes: Array<{ name: string; fragment: string }>;
  characters: Array<{ id: string; name: string }>;
  rotateCharacters: boolean;
  startDate: Date;
}): SeriesItemDraft[] {
  const pool = input.scenes.filter((s) => s.fragment !== input.slots.scene);
  const scenes = pool.length > 0 ? pool : input.scenes;
  if (scenes.length === 0 || input.count < 1) return [];

  const items: SeriesItemDraft[] = [];
  for (let i = 0; i < input.count; i++) {
    const scene = scenes[i % scenes.length];
    let characterId = input.slots.characterId;
    if (input.rotateCharacters && input.characters.length > 0) {
      characterId = input.characters[i % input.characters.length].id;
    }
    const date = new Date(input.startDate.getTime() + i * 24 * 60 * 60 * 1000);
    items.push({
      formatId: input.formatId,
      templateId: input.templateId,
      modelSlug: input.fixed.modelSlug,
      durationS: input.fixed.durationS,
      aspectRatio: input.fixed.aspectRatio,
      scene: scene.fragment,
      audio: input.fixed.audio,
      characterId,
      scenePrompt: input.slots.scenePrompt,
      scheduledDate: date.toISOString().slice(0, 10),
    });
  }
  return items;
}
