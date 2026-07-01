import { describe, it, expect, vi, beforeEach } from 'vitest';

const nanoMock = vi.fn();
const extendMock = vi.fn();
const uploadSafeBaseMock = vi.fn();
const dlRefMock = vi.fn();
const dlOutMock = vi.fn();

vi.mock('@/lib/providers/nano-banana', () => ({
  generate: (...a: unknown[]) => nanoMock(...a),
  NANO_MODEL_SLUG: 'gemini-3-pro-image-preview',
  NANO_VARIANT: '2K',
  nanoVariantToResolution: () => '2K',
}));
vi.mock('@/lib/campaigns/storyboard-expand', () => ({ extendPanelTo916: (...a: unknown[]) => extendMock(...a) }));
vi.mock('@/lib/supabase/storage', () => ({
  uploadSafeBase: (...a: unknown[]) => uploadSafeBaseMock(...a),
  downloadReferenceBuffer: (...a: unknown[]) => dlRefMock(...a),
  downloadOutputBuffer: (...a: unknown[]) => dlOutMock(...a),
}));
vi.mock('@/lib/images/safe-area', () => ({ centralSafeCrop: async (b: Buffer) => b }));

import { nanoBananaHandler } from './nano-banana';
import type { GenerationRow } from './types';

function row(strict: boolean, prevTurn: unknown = null): GenerationRow {
  return {
    id: 'gen-1', user_id: 'u', workspace_id: 'ws', type: 'image', provider: 'nano-banana',
    model_id: 'gemini-3-pro-image-preview', prompt: 'do it',
    params: { storyboard: { campaignItemId: 'item-1', campaignId: 'c', genAspect: strict ? '4:5' : '9:16', strict, conversational: prevTurn !== null, referencePaths: [], chatRefPaths: [], prevTurn } },
    reference_ids: [], status: 'processing', provider_task_id: null,
    provider_payload: null, poll_attempts: 0, timeout_at: null, cancel_requested: false, credits_estimated: 10,
  };
}

beforeEach(() => { nanoMock.mockReset(); extendMock.mockReset(); uploadSafeBaseMock.mockReset(); dlRefMock.mockReset(); dlOutMock.mockReset(); });

describe('nanoBananaHandler', () => {
  it('no estricto submit -> finalize con thought_signature en metadata', async () => {
    nanoMock.mockResolvedValue({ buffer: Buffer.from('img'), mimeType: 'image/jpeg', thoughtSignature: 'sig' });
    const res = await nanoBananaHandler.handle(row(false), 'submit');
    expect(res.kind).toBe('finalize');
    if (res.kind === 'finalize') {
      expect(res.outputBuffer).toEqual(Buffer.from('img'));
      expect(res.metadata).toEqual({ thought_signature: 'sig' });
    }
  });
  it('estricto submit -> continue con safe_base_path en providerPayload', async () => {
    nanoMock.mockResolvedValue({ buffer: Buffer.from('base'), mimeType: 'image/jpeg', thoughtSignature: 'sig' });
    uploadSafeBaseMock.mockResolvedValue('ws/gen-1/safe-base.jpg');
    const res = await nanoBananaHandler.handle(row(true), 'submit');
    expect(res.kind).toBe('continue');
    if (res.kind === 'continue') {
      expect(res.providerPayload).toEqual({ thought_signature: 'sig', safe_base_path: 'ws/gen-1/safe-base.jpg' });
    }
  });
  it('estricto poll -> descarga safe_base, expande, finalize', async () => {
    dlOutMock.mockResolvedValue({ buffer: Buffer.from('base'), mimeType: 'image/jpeg' });
    extendMock.mockResolvedValue({ buffer: Buffer.from('916'), mimeType: 'image/jpeg' });
    const r = row(true);
    r.provider_payload = { thought_signature: 'sig', safe_base_path: 'ws/gen-1/safe-base.jpg' };
    const res = await nanoBananaHandler.handle(r, 'poll');
    expect(res.kind).toBe('finalize');
    if (res.kind === 'finalize') {
      expect(res.outputBuffer).toEqual(Buffer.from('916'));
      expect(res.metadata).toEqual({ thought_signature: 'sig', safe_base_path: 'ws/gen-1/safe-base.jpg' });
    }
  });
  it('un ProviderError de Nano -> fail con code safety', async () => {
    const { ProviderError } = await import('@/lib/providers/types');
    nanoMock.mockRejectedValue(new ProviderError('moderado', 'safety', false));
    const res = await nanoBananaHandler.handle(row(false), 'submit');
    expect(res.kind).toBe('fail');
    if (res.kind === 'fail') expect(res.code).toBe('safety');
  });
});

describe('resolvePrevTurnSignature', () => {
  it('firma inline (job legacy encolado antes del cambio) se honra sin tocar la BD', async () => {
    const { resolvePrevTurnSignature } = await import('./nano-banana');
    const sig = await resolvePrevTurnSignature({ imagePath: 'p', prompt: 'x', thoughtSignature: 'legacy-sig' });
    expect(sig).toBe('legacy-sig');
  });
  it('sin firma ni referencia -> undefined (buildBody degrada a single-turn)', async () => {
    const { resolvePrevTurnSignature } = await import('./nano-banana');
    const sig = await resolvePrevTurnSignature({ imagePath: 'p', prompt: 'x' });
    expect(sig).toBeUndefined();
  });
});
