import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

const expandMock = vi.fn();
vi.mock('@/lib/providers/flux-expand', () => ({ expand: (...a: unknown[]) => expandMock(...a) }));
const checkMock = vi.fn();
const baseCheckMock = vi.fn();
vi.mock('./storyboard-expand-check', () => ({
  expandedBandsHaveText: (...a: unknown[]) => checkMock(...a),
  baseBottomHasText: (...a: unknown[]) => baseCheckMock(...a),
}));

import { extendPanelTo916 } from './storyboard-expand';

beforeEach(() => {
  expandMock.mockReset();
  checkMock.mockReset();
  checkMock.mockResolvedValue(false);
  baseCheckMock.mockReset();
  baseCheckMock.mockResolvedValue(false);
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
    expect(expandMock).toHaveBeenCalledTimes(1);
  });

  it('propaga el error del expand (sin fallback)', async () => {
    const base = await sharp({ create: { width: 360, height: 450, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    expandMock.mockRejectedValue(new Error('moderado'));
    await expect(extendPanelTo916({ buffer: base, mimeType: 'image/jpeg' })).rejects.toThrow('moderado');
  });

  it('con sceneHint, el prompt ancla la escenografia de la locacion', async () => {
    const base = await sharp({ create: { width: 360, height: 450, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    expandMock.mockResolvedValue({ buffer: Buffer.from('out'), mimeType: 'image/jpeg' });
    await extendPanelTo916({ buffer: base, mimeType: 'image/jpeg' }, 'Jardin moderno: plantas verdes');
    const arg = expandMock.mock.calls[0][0] as { prompt: string };
    expect(arg.prompt).toContain('The scene being extended is: Jardin moderno: plantas verdes.');
    expect(arg.prompt).toContain('must belong to that same place');
    expect(arg.prompt).toContain('Absolutely no text of any kind');
  });

  it('sin sceneHint, el prompt queda neutro (sin clausula de escena)', async () => {
    const base = await sharp({ create: { width: 360, height: 450, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    expandMock.mockResolvedValue({ buffer: Buffer.from('out'), mimeType: 'image/jpeg' });
    await extendPanelTo916({ buffer: base, mimeType: 'image/jpeg' });
    const arg = expandMock.mock.calls[0][0] as { prompt: string };
    expect(arg.prompt).not.toContain('The scene being extended is');
  });

  it('texto en bandas al primer intento -> reintenta y devuelve el segundo', async () => {
    const base = await sharp({ create: { width: 360, height: 450, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    expandMock
      .mockResolvedValueOnce({ buffer: Buffer.from('con-texto'), mimeType: 'image/jpeg' })
      .mockResolvedValueOnce({ buffer: Buffer.from('limpio'), mimeType: 'image/jpeg' });
    checkMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const out = await extendPanelTo916({ buffer: base, mimeType: 'image/jpeg' });
    expect(out.buffer).toEqual(Buffer.from('limpio'));
    expect(expandMock).toHaveBeenCalledTimes(2);
  });

  it('texto en bandas en TODOS los intentos -> falla limpio con motivo accionable', async () => {
    const base = await sharp({ create: { width: 360, height: 450, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    expandMock.mockResolvedValue({ buffer: Buffer.from('con-texto'), mimeType: 'image/jpeg' });
    checkMock.mockResolvedValue(true);
    await expect(extendPanelTo916({ buffer: base, mimeType: 'image/jpeg' })).rejects.toThrow(
      'agrego texto o rotulos',
    );
    expect(expandMock).toHaveBeenCalledTimes(3);
  });

  it('texto en bandas dos veces y limpio a la tercera -> devuelve el tercero', async () => {
    const base = await sharp({ create: { width: 360, height: 450, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    expandMock
      .mockResolvedValueOnce({ buffer: Buffer.from('texto-1'), mimeType: 'image/jpeg' })
      .mockResolvedValueOnce({ buffer: Buffer.from('texto-2'), mimeType: 'image/jpeg' })
      .mockResolvedValueOnce({ buffer: Buffer.from('limpio'), mimeType: 'image/jpeg' });
    checkMock.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const out = await extendPanelTo916({ buffer: base, mimeType: 'image/jpeg' });
    expect(out.buffer).toEqual(Buffer.from('limpio'));
    expect(expandMock).toHaveBeenCalledTimes(3);
  });

  it('base con texto quemado al pie -> falla ANTES de gastar expand, con el motivo real', async () => {
    const base = await sharp({ create: { width: 360, height: 450, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    baseCheckMock.mockResolvedValue(true);
    await expect(extendPanelTo916({ buffer: base, mimeType: 'image/jpeg' })).rejects.toThrow(
      'texto o subtitulos quemados',
    );
    expect(expandMock).not.toHaveBeenCalled();
  });
});
