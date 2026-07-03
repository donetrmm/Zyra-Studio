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

import { extendPanelTo916Attempt, MAX_EXPAND_ATTEMPTS } from './storyboard-expand';

async function makeBase() {
  return sharp({ create: { width: 360, height: 450, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .jpeg()
    .toBuffer();
}

beforeEach(() => {
  expandMock.mockReset();
  checkMock.mockReset();
  checkMock.mockResolvedValue(false);
  baseCheckMock.mockReset();
  baseCheckMock.mockResolvedValue(false);
});

// Un intento por invocación: el loop de reintentos vive en hops de QStash (el
// worker re-encola con expand_attempt+1), no aquí — 3 intentos inline excedían
// el maxDuration de 60s y dejaban la generación colgada en processing.
describe('extendPanelTo916Attempt', () => {
  it('llama a expand con top/bottom = bandPx del ancho de la base', async () => {
    const base = await makeBase();
    expandMock.mockResolvedValue({ buffer: Buffer.from('out'), mimeType: 'image/jpeg' });
    const out = await extendPanelTo916Attempt({ buffer: base, mimeType: 'image/jpeg' }, 1);
    expect(out).toEqual({ ok: true, buffer: Buffer.from('out'), mimeType: 'image/jpeg' });
    const arg = expandMock.mock.calls[0][0] as { top: number; bottom: number };
    expect(arg.top).toBe(95);
    expect(arg.bottom).toBe(95);
    expect(expandMock).toHaveBeenCalledTimes(1);
  });

  it('propaga el error del expand (sin fallback)', async () => {
    const base = await makeBase();
    expandMock.mockRejectedValue(new Error('moderado'));
    await expect(extendPanelTo916Attempt({ buffer: base, mimeType: 'image/jpeg' }, 1)).rejects.toThrow('moderado');
  });

  it('con sceneHint, el prompt ancla la escenografia de la locacion', async () => {
    const base = await makeBase();
    expandMock.mockResolvedValue({ buffer: Buffer.from('out'), mimeType: 'image/jpeg' });
    await extendPanelTo916Attempt({ buffer: base, mimeType: 'image/jpeg' }, 1, 'Jardin moderno: plantas verdes');
    const arg = expandMock.mock.calls[0][0] as { prompt: string };
    expect(arg.prompt).toContain('The scene being extended is: Jardin moderno: plantas verdes.');
    expect(arg.prompt).toContain('must belong to that same place');
    expect(arg.prompt).toContain('Absolutely no text of any kind');
  });

  it('sin sceneHint, el prompt queda neutro (sin clausula de escena)', async () => {
    const base = await makeBase();
    expandMock.mockResolvedValue({ buffer: Buffer.from('out'), mimeType: 'image/jpeg' });
    await extendPanelTo916Attempt({ buffer: base, mimeType: 'image/jpeg' }, 1);
    const arg = expandMock.mock.calls[0][0] as { prompt: string };
    expect(arg.prompt).not.toContain('The scene being extended is');
  });

  it('texto en bandas y quedan intentos -> ok:false (el worker re-encola), UN solo expand', async () => {
    const base = await makeBase();
    expandMock.mockResolvedValue({ buffer: Buffer.from('con-texto'), mimeType: 'image/jpeg' });
    checkMock.mockResolvedValue(true);
    const out = await extendPanelTo916Attempt({ buffer: base, mimeType: 'image/jpeg' }, 1);
    expect(out).toEqual({ ok: false });
    expect(expandMock).toHaveBeenCalledTimes(1);
  });

  it('texto en bandas en el ULTIMO intento -> falla limpio con motivo accionable', async () => {
    const base = await makeBase();
    expandMock.mockResolvedValue({ buffer: Buffer.from('con-texto'), mimeType: 'image/jpeg' });
    checkMock.mockResolvedValue(true);
    await expect(
      extendPanelTo916Attempt({ buffer: base, mimeType: 'image/jpeg' }, MAX_EXPAND_ATTEMPTS),
    ).rejects.toThrow('agrego texto o rotulos');
    expect(expandMock).toHaveBeenCalledTimes(1);
  });

  it('base con texto quemado al pie -> falla ANTES de gastar expand, con el motivo real', async () => {
    const base = await makeBase();
    baseCheckMock.mockResolvedValue(true);
    await expect(extendPanelTo916Attempt({ buffer: base, mimeType: 'image/jpeg' }, 1)).rejects.toThrow(
      'texto o subtitulos quemados',
    );
    expect(expandMock).not.toHaveBeenCalled();
  });

  it('el gate de la base solo corre en el intento 1 (ya paso; re-checar quema una llamada de vision)', async () => {
    const base = await makeBase();
    baseCheckMock.mockResolvedValue(true); // aunque diga que hay texto...
    expandMock.mockResolvedValue({ buffer: Buffer.from('out'), mimeType: 'image/jpeg' });
    const out = await extendPanelTo916Attempt({ buffer: base, mimeType: 'image/jpeg' }, 2);
    expect(out.ok).toBe(true);
    expect(baseCheckMock).not.toHaveBeenCalled();
  });
});
