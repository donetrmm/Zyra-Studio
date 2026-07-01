import { describe, it, expect } from 'vitest';
import { buildStoryboardJobPayload } from './storyboard-job';

describe('buildStoryboardJobPayload', () => {
  it('fresco (sin prevTurn): conversational false, prevTurn null', () => {
    const p = buildStoryboardJobPayload({
      campaignItemId: 'item-1', campaignId: 'camp-1', genAspect: '9:16', strict: false,
      referencePaths: ['ws/prod.png', 'ws/loc.png'], chatRefPaths: [], prevTurn: null,
    });
    expect(p).toEqual({
      campaignItemId: 'item-1', campaignId: 'camp-1', genAspect: '9:16', strict: false,
      conversational: false, referencePaths: ['ws/prod.png', 'ws/loc.png'], chatRefPaths: [], prevTurn: null,
    });
  });
  it('encadenado estricto: conversational true, genAspect 4:5, prevTurn con path/sig', () => {
    const p = buildStoryboardJobPayload({
      campaignItemId: 'item-2', campaignId: 'camp-1', genAspect: '4:5', strict: true,
      referencePaths: [], chatRefPaths: ['ws/prod.png'],
      prevTurn: { imagePath: 'ws/gen/safe-base.jpg', thoughtSignature: 'sig', prompt: 'prev' },
    });
    expect(p.conversational).toBe(true);
    expect(p.genAspect).toBe('4:5');
    expect(p.prevTurn).toEqual({ imagePath: 'ws/gen/safe-base.jpg', thoughtSignature: 'sig', prompt: 'prev' });
  });
});
