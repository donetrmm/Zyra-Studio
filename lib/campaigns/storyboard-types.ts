import type { PanelVersion } from './storyboard-versions';

// Tipo de beat de storyboard: una escena con panel generado o pendiente
export type StoryboardBeat = {
  id: string;
  sceneIndex: number;
  scenePrompt: string;
  storyboardImageId: string | null;
  // Gen actualmente enlazada: marca "actual" en el historial de versiones.
  storyboardGenerationId: string | null;
  panelUrl: string | null;
  durationS: number;
  // Locacion anclada a la escena (por creativo). null = sin locacion.
  locationId: string | null;
  // Motivo persistido del último fallo de generación del panel (worker lo anota,
  // la action de regenerar lo limpia). Vacío = sin aviso.
  warnings: string[];
  // Versiones restaurables del panel (gens done del beat, más reciente primero).
  versions: PanelVersion[];
};
