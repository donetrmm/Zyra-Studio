import { describe, it, expect, vi, beforeEach } from 'vitest';

const nanoMock = vi.fn();
const extendMock = vi.fn();
const uploadSafeBaseMock = vi.fn();
const uploadSigMock = vi.fn();
const dlRefMock = vi.fn();
const dlOutMock = vi.fn();

vi.mock('@/lib/providers/nano-banana', () => ({
  generate: (...a: unknown[]) => nanoMock(...a),
  NANO_MODEL_SLUG: 'gemini-3-pro-image-preview',
  NANO_VARIANT: '2K',
  nanoVariantToResolution: () => '2K',
}));
vi.mock('@/lib/campaigns/storyboard-expand', () => ({
  extendPanelTo916Attempt: (...a: unknown[]) => extendMock(...a),
  MAX_EXPAND_ATTEMPTS: 3,
}));
vi.mock('@/lib/supabase/storage', () => ({
  uploadSafeBase: (...a: unknown[]) => uploadSafeBaseMock(...a),
  uploadThoughtSignature: (...a: unknown[]) => uploadSigMock(...a),
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

beforeEach(() => {
  nanoMock.mockReset(); extendMock.mockReset(); uploadSafeBaseMock.mockReset();
  uploadSigMock.mockReset(); dlRefMock.mockReset(); dlOutMock.mockReset();
  uploadSigMock.mockResolvedValue('ws/gen-1/thought-signature.txt');
});

describe('nanoBananaHandler', () => {
  it('no estricto submit -> finalize con el PATH de la firma en metadata (nunca inline)', async () => {
    nanoMock.mockResolvedValue({ buffer: Buffer.from('img'), mimeType: 'image/jpeg', thoughtSignature: 'sig' });
    const res = await nanoBananaHandler.handle(row(false), 'submit');
    expect(res.kind).toBe('finalize');
    if (res.kind === 'finalize') {
      expect(res.outputBuffer).toEqual(Buffer.from('img'));
      expect(res.metadata).toEqual({ thought_signature_path: 'ws/gen-1/thought-signature.txt' });
    }
    expect(uploadSigMock).toHaveBeenCalledWith('ws', 'gen-1', 'sig');
  });
  it('estricto submit -> continue con safe_base_path y el PATH de la firma', async () => {
    nanoMock.mockResolvedValue({ buffer: Buffer.from('base'), mimeType: 'image/jpeg', thoughtSignature: 'sig' });
    uploadSafeBaseMock.mockResolvedValue('ws/gen-1/safe-base.jpg');
    const res = await nanoBananaHandler.handle(row(true), 'submit');
    expect(res.kind).toBe('continue');
    if (res.kind === 'continue') {
      expect(res.providerPayload).toEqual({
        thought_signature_path: 'ws/gen-1/thought-signature.txt',
        safe_base_path: 'ws/gen-1/safe-base.jpg',
      });
    }
  });
  it('sin firma del provider -> no sube nada ni mete claves vacias', async () => {
    nanoMock.mockResolvedValue({ buffer: Buffer.from('img'), mimeType: 'image/jpeg' });
    const res = await nanoBananaHandler.handle(row(false), 'submit');
    expect(res.kind).toBe('finalize');
    if (res.kind === 'finalize') expect(res.metadata).toEqual({});
    expect(uploadSigMock).not.toHaveBeenCalled();
  });
  it('estricto poll -> descarga safe_base, expande (limpio), finalize; primer intento por default', async () => {
    dlOutMock.mockResolvedValue({ buffer: Buffer.from('base'), mimeType: 'image/jpeg' });
    extendMock.mockResolvedValue({ ok: true, buffer: Buffer.from('916'), mimeType: 'image/jpeg' });
    const r = row(true);
    r.provider_payload = { thought_signature: 'sig', safe_base_path: 'ws/gen-1/safe-base.jpg' };
    const res = await nanoBananaHandler.handle(r, 'poll');
    expect(res.kind).toBe('finalize');
    if (res.kind === 'finalize') {
      expect(res.outputBuffer).toEqual(Buffer.from('916'));
      expect(res.metadata).toEqual({ thought_signature: 'sig', safe_base_path: 'ws/gen-1/safe-base.jpg' });
    }
    // (base, attempt, sceneHint): sin expand_attempt en el payload, es el intento 1.
    expect(extendMock.mock.calls[0][1]).toBe(1);
  });
  it('estricto poll con texto en bandas y quedan intentos -> continue con expand_attempt+1 (hop QStash)', async () => {
    dlOutMock.mockResolvedValue({ buffer: Buffer.from('base'), mimeType: 'image/jpeg' });
    extendMock.mockResolvedValue({ ok: false });
    const r = row(true);
    r.provider_payload = { safe_base_path: 'ws/gen-1/safe-base.jpg' };
    const res = await nanoBananaHandler.handle(r, 'poll');
    expect(res.kind).toBe('continue');
    if (res.kind === 'continue') {
      expect(res.providerPayload).toEqual({ expand_attempt: 2 });
      expect(res.delaySeconds).toBe(0);
    }
  });
  it('estricto poll con expand_attempt en el payload -> pasa ese intento al expand', async () => {
    dlOutMock.mockResolvedValue({ buffer: Buffer.from('base'), mimeType: 'image/jpeg' });
    extendMock.mockResolvedValue({ ok: true, buffer: Buffer.from('916'), mimeType: 'image/jpeg' });
    const r = row(true);
    r.provider_payload = { safe_base_path: 'ws/gen-1/safe-base.jpg', expand_attempt: 3 };
    const res = await nanoBananaHandler.handle(r, 'poll');
    expect(res.kind).toBe('finalize');
    expect(extendMock.mock.calls[0][1]).toBe(3);
  });
  it('el ProviderError del expand (ultimo intento con texto) -> fail limpio', async () => {
    const { ProviderError } = await import('@/lib/providers/types');
    dlOutMock.mockResolvedValue({ buffer: Buffer.from('base'), mimeType: 'image/jpeg' });
    extendMock.mockRejectedValue(new ProviderError('agrego texto o rotulos', 'unknown', false));
    const r = row(true);
    r.provider_payload = { safe_base_path: 'ws/gen-1/safe-base.jpg', expand_attempt: 3 };
    const res = await nanoBananaHandler.handle(r, 'poll');
    expect(res.kind).toBe('fail');
    if (res.kind === 'fail') expect(res.message).toContain('agrego texto o rotulos');
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
  it('sin firma ni referencia -> undefined (buildRequest degrada a single-turn)', async () => {
    const { resolvePrevTurnSignature } = await import('./nano-banana');
    const sig = await resolvePrevTurnSignature({ imagePath: 'p', prompt: 'x' });
    expect(sig).toBeUndefined();
  });
});
