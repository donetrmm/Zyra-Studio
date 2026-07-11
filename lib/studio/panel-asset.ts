import 'server-only';
import type { StudioAssetImages } from '@/components/studio/types';

export type PanelAssetInput = {
  name: string;
  panelImageId: string | null;
  beatReferenceIds: string[];
  scenePrompt: string;
  aspectRatio: string | null;
};

// Arma la variante 'panel' de StudioAssetImages. cleanReferenceIds = el panel
// actual (si existe) primero, luego las refs limpias del beat, dedup y sin null,
// preservando el orden. El panel va primero para que, en un panel subido a mano
// (sin generación base), siga a mano en el selector de referencias.
export function buildPanelAssetImages(
  input: PanelAssetInput,
): Extract<StudioAssetImages, { assetType: 'panel' }> {
  const ordered = [
    ...(input.panelImageId ? [input.panelImageId] : []),
    ...input.beatReferenceIds,
  ];
  const cleanReferenceIds = [...new Set(ordered)];
  return {
    assetType: 'panel',
    name: input.name,
    panelImageId: input.panelImageId,
    cleanReferenceIds,
    scenePrompt: input.scenePrompt,
    aspectRatio: input.aspectRatio,
  };
}
