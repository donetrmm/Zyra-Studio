import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

const expandMock = vi.fn();
vi.mock('@/lib/providers/flux-expand', () => ({ expand: (...a: unknown[]) => expandMock(...a) }));

import { extendPanelTo916 } from './storyboard-expand';

beforeEach(() => {
  expandMock.mockReset();
});

describe('extendPanelTo916', () => {
  it('llama a expand con top/bottom = bandPx del ancho de la base', async () => {
    const base = await sharp({ create: { width: 360, height: 450, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    expandMock.mockResolvedValue({ buffer: Buffer.from('out'), mimeType: 'image/jpeg' });
    const out = await extendPanelTo916({ buffer: base, mimeType: 'image/jpeg' });
    expect(out).toEqual({ buffer: Buffer.from('out'), mimeType: 'image/jpeg' });
    const arg = expandMock.mock.calls[0][0] as { top: number; bottom: number };
    expect(arg.top).toBe(95);
    expect(arg.bottom).toBe(95);
  });
  it('propaga el error del expand (sin fallback)', async () => {
    const base = await sharp({ create: { width: 360, height: 450, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    expandMock.mockRejectedValue(new Error('moderado'));
    await expect(extendPanelTo916({ buffer: base, mimeType: 'image/jpeg' })).rejects.toThrow('moderado');
  });
});
