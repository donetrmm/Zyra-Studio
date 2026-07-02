import { describe, it, expect } from 'vitest';
import { panelUpdateFromRow, slimPanelRow } from './use-storyboard-panel-realtime';

const CAMPAIGN = 'camp-1';

describe('panelUpdateFromRow', () => {
  it('mapea una fila de storyboard de la misma campana (con generationId)', () => {
    const row = {
      id: 'gen-1',
      campaign_id: CAMPAIGN,
      status: 'done',
      error_message: null,
      params: { storyboard: { campaignItemId: 'item-7' } },
    };
    expect(panelUpdateFromRow(row, CAMPAIGN)).toEqual({
      campaignItemId: 'item-7',
      status: 'done',
      errorMessage: null,
      generationId: 'gen-1',
    });
  });

  it('propaga error_message y status failed', () => {
    const row = {
      id: 'gen-2',
      campaign_id: CAMPAIGN,
      status: 'failed',
      error_message: 'moderado',
      params: { storyboard: { campaignItemId: 'item-7' } },
    };
    expect(panelUpdateFromRow(row, CAMPAIGN)).toEqual({
      campaignItemId: 'item-7',
      status: 'failed',
      errorMessage: 'moderado',
      generationId: 'gen-2',
    });
  });

  it('sin id (payload viejo) -> generationId null, no revienta', () => {
    const row = {
      campaign_id: CAMPAIGN,
      status: 'done',
      error_message: null,
      params: { storyboard: { campaignItemId: 'item-7' } },
    };
    expect(panelUpdateFromRow(row, CAMPAIGN)?.generationId).toBeNull();
  });

  it('filtra en el cliente por campaign_id (otra campana => null)', () => {
    const row = {
      campaign_id: 'otra',
      status: 'done',
      error_message: null,
      params: { storyboard: { campaignItemId: 'item-7' } },
    };
    expect(panelUpdateFromRow(row, CAMPAIGN)).toBeNull();
  });

  it('ignora generaciones que no son de storyboard', () => {
    const row = { campaign_id: CAMPAIGN, status: 'done', error_message: null, params: {} };
    expect(panelUpdateFromRow(row, CAMPAIGN)).toBeNull();
  });

  it('ignora payload de storyboard sin campaignItemId string', () => {
    const row = {
      campaign_id: CAMPAIGN,
      status: 'processing',
      error_message: null,
      params: { storyboard: { campaignItemId: 123 } },
    };
    expect(panelUpdateFromRow(row, CAMPAIGN)).toBeNull();
  });
});

describe('slimPanelRow', () => {
  it('adapta la fila ligera (JSON path) al shape de panelUpdateFromRow, con id', () => {
    const slim = { id: 'gen-9', campaign_id: CAMPAIGN, status: 'done', error_message: null, beat_id: 'beat-9' };
    const u = panelUpdateFromRow(slimPanelRow(slim), CAMPAIGN);
    expect(u).toEqual({ campaignItemId: 'beat-9', status: 'done', errorMessage: null, generationId: 'gen-9' });
  });
  it('beat_id null (gen sin storyboard) -> panelUpdateFromRow la descarta', () => {
    const slim = { id: 'gen-9', campaign_id: CAMPAIGN, status: 'done', error_message: null, beat_id: null };
    expect(panelUpdateFromRow(slimPanelRow(slim), CAMPAIGN)).toBeNull();
  });
});
