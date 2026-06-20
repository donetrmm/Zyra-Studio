// Tipo de beat de storyboard: una escena con panel generado o pendiente
export type StoryboardBeat = {
  id: string;
  sceneIndex: number;
  scenePrompt: string;
  storyboardImageId: string | null;
  panelUrl: string | null;
  durationS: number;
};
