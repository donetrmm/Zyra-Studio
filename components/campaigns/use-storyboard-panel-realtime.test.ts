import { describe, it, expect } from 'vitest';
import { panelUpdateFromRow, slimPanelRow } from './use-storyboard-panel-realtime';

const CAMPAIGN = 'camp-1';

describe('panelUpdateFromRow', () => {
  it('mapea una fila de storyboard de la misma campana', () => {
    const row = {
      campaign_id: CAMPAIGN,
      status: 'done',
      error_message: null,
      params: { storyboard: { campaignItemId: 'item-7' } },
    };
    expect(panelUpdateFromRow(row, CAMPAIGN)).toEqual({
      campaignItemId: 'item-7',
      status: 'done',
      errorMessage: null,
    });
  });

  it('propaga error_message y status failed', () => {
    const row = {
      campaign_id: CAMPAIGN,
      status: 'failed',
      error_message: 'moderado',
      params: { storyboard: { campaignItemId: 'item-7' } },
    };
    expect(panelUpdateFromRow(row, CAMPAIGN)).toEqual({
      campaignItemId: 'item-7',
      status: 'failed',
      errorMessage: 'moderado',
    });
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
  const CAMPAIGN = 'camp-1';
  it('adapta la fila ligera (JSON path) al shape de panelUpdateFromRow', () => {
    const slim = { campaign_id: CAMPAIGN, status: 'done', error_message: null, beat_id: 'beat-9' };
    const u = panelUpdateFromRow(slimPanelRow(slim), CAMPAIGN);
    expect(u).toEqual({ campaignItemId: 'beat-9', status: 'done', errorMessage: null });
  });
  it('beat_id null (gen sin storyboard) -> panelUpdateFromRow la descarta', () => {
    const slim = { campaign_id: CAMPAIGN, status: 'done', error_message: null, beat_id: null };
    expect(panelUpdateFromRow(slimPanelRow(slim), CAMPAIGN)).toBeNull();
  });
});
