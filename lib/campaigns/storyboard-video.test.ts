import { describe, it, expect } from 'vitest';
import { buildCastR2VRefs } from './storyboard-video';

describe('buildCastR2VRefs', () => {
  it('pone el panel al final y lo cita como @image{N+1}', () => {
    const { referenceImagePaths, panelCitation } = buildCastR2VRefs(['cast-a.png', 'cast-b.png'], 'panel.png');
    expect(referenceImagePaths).toEqual(['cast-a.png', 'cast-b.png', 'panel.png']);
    expect(panelCitation).toContain('@image3');
  });
  it('con un solo cast, el panel es @image2', () => {
    const { referenceImagePaths, panelCitation } = buildCastR2VRefs(['cast-a.png'], 'panel.png');
    expect(referenceImagePaths).toEqual(['cast-a.png', 'panel.png']);
    expect(panelCitation).toContain('@image2');
  });
  it('sin cast, el panel es @image1', () => {
    const { referenceImagePaths, panelCitation } = buildCastR2VRefs([], 'panel.png');
    expect(referenceImagePaths).toEqual(['panel.png']);
    expect(panelCitation).toContain('@image1');
  });
});
