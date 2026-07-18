import { describe, it, expect } from 'vitest';
import { storyboardCampaignItemId, isStalePromote } from './storyboard-finalize';
import type { GenerationRow } from './handlers/types';

function gen(params: Record<string, unknown>): GenerationRow {
  return {
    id: 'g', user_id: 'u', workspace_id: 'ws', type: 'image', provider: 'nano-banana',
    model_id: 'm', prompt: null, params, reference_ids: [], parent_generation_id: null, status: 'done',
    provider_task_id: null, provider_payload: null, poll_attempts: 0, timeout_at: null,
    cancel_requested: false, credits_estimated: 0,
  };
}

describe('storyboardCampaignItemId', () => {
  it('devuelve el campaignItemId cuando el payload existe', () => {
    expect(storyboardCampaignItemId(gen({ storyboard: { campaignItemId: 'item-9' } }))).toBe('item-9');
  });
  it('devuelve null cuando no es una generacion de storyboard', () => {
    expect(storyboardCampaignItemId(gen({}))).toBeNull();
  });
});

describe('isStalePromote', () => {
  it('promueve cuando no hay panel enlazado previo', () => {
    expect(isStalePromote('2026-07-01T10:00:00Z', null)).toBe(false);
    expect(isStalePromote('2026-07-01T10:00:00Z', undefined)).toBe(false);
  });
  it('promueve cuando esta gen es más nueva que la enlazada', () => {
    expect(isStalePromote('2026-07-01T10:05:00Z', '2026-07-01T10:00:00Z')).toBe(false);
  });
  it('NO promueve cuando la enlazada es más nueva (retry tardío de una gen vieja)', () => {
    expect(isStalePromote('2026-07-01T10:00:00Z', '2026-07-01T10:05:00Z')).toBe(true);
  });
  it('promueve si falta el created_at propio (mejor enlazar que dejar huérfano)', () => {
    expect(isStalePromote(null, '2026-07-01T10:05:00Z')).toBe(false);
  });
});
