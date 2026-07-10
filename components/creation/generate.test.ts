import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/server-actions/generations', () => ({ submitGenerationAction: vi.fn() }));
vi.mock('@/server-actions/media-references', () => ({ addGenerationAsReferenceAction: vi.fn() }));

import { submitGenerationAction } from '@/server-actions/generations';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import type { SubmitGenerationInput } from '@/lib/schemas/generations';
import { generateCharacterState, isGenError, generateScaleMap, generateScaleMapFromMaster, retouchUploaded, generateFullBody, generateOutfit } from './generate';

describe('generateCharacterState', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hornea un estado preservando identidad vía editUploaded', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: true, data: { generationId: 'gen1' } });
    vi.mocked(addGenerationAsReferenceAction).mockResolvedValue({ ok: true, data: { id: 'ref1', previewUrl: 'p', storagePath: 's', filename: 'f.png' } });
    const res = await generateCharacterState({ id: 'm', storagePath: 'ws/m.png' }, 'wet hair and soaked clothing, sweat on the forehead');
    expect(isGenError(res)).toBe(false);
    const call = vi.mocked(submitGenerationAction).mock.calls[0][0] as SubmitGenerationInput;
    expect(call.provider).toBe('nano-banana');
    expect((call as Extract<SubmitGenerationInput, { provider: 'nano-banana' }>).conversational).toBe(false);
    expect(call.references).toEqual([{ id: 'm', storagePath: 'ws/m.png' }]);
    expect(call.prompt).toMatch(/wet hair and soaked clothing/);
    expect(call.prompt).toMatch(/Keep the person's identity perfectly consistent/i);
  });
});

describe('generateScaleMap', () => {
  beforeEach(() => vi.clearAllMocks());

  it('genera un diagrama top-down con FLUX (no photoreal) y lo fija como referencia', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: true, data: { generationId: 'gen1' } });
    vi.mocked(addGenerationAsReferenceAction).mockResolvedValue({
      ok: true,
      data: { id: 'ref1', previewUrl: 'p', storagePath: 's', filename: 'f.png' },
    });

    const res = await generateScaleMap('a city sidewalk with an inflatable mascot');

    expect(isGenError(res)).toBe(false);
    if (!isGenError(res)) expect(res.refId).toBe('ref1');

    const call = vi.mocked(submitGenerationAction).mock.calls[0][0] as SubmitGenerationInput;
    expect(call.provider).toBe('flux');
    expect(call.model).toBe('flux-2-pro-preview');
    expect((call as Extract<SubmitGenerationInput, { provider: 'flux' }>).variant).toBe('default');
    expect(call.aspectRatio).toBe('1:1');
    expect((call as Extract<SubmitGenerationInput, { provider: 'flux' }>).megapixels).toBe(2);
    expect((call as Extract<SubmitGenerationInput, { provider: 'flux' }>).photoreal).toBe(false);
    expect(call.references).toEqual([]);
    expect(call.prompt).toMatch(/top-down/i);
    expect(call.prompt).toMatch(/schematic|floor-plan/i);
  });

  it('propaga el error de la generación', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: false, error: 'provider_error', message: 'boom' });
    const res = await generateScaleMap('x');
    expect(isGenError(res)).toBe(true);
    if (isGenError(res)) expect(res.message).toBe('boom');
  });
});

describe('generateScaleMapFromMaster', () => {
  beforeEach(() => vi.clearAllMocks());

  it('redibuja la maestra como top-down vía Nano Banana (editUploaded), pasándola como referencia', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: true, data: { generationId: 'gen1' } });
    vi.mocked(addGenerationAsReferenceAction).mockResolvedValue({
      ok: true,
      data: { id: 'ref1', previewUrl: 'p', storagePath: 's', filename: 'f.png' },
    });

    const res = await generateScaleMapFromMaster({ id: 'm', storagePath: 'ws/m.png' }, 'a city sidewalk');

    expect(isGenError(res)).toBe(false);
    if (!isGenError(res)) expect(res.refId).toBe('ref1');

    const call = vi.mocked(submitGenerationAction).mock.calls[0][0] as SubmitGenerationInput;
    expect(call.provider).toBe('nano-banana');
    // editUploaded: la maestra entra como referencia, no como parent conversacional.
    expect((call as Extract<SubmitGenerationInput, { provider: 'nano-banana' }>).conversational).toBe(false);
    expect(call.references).toEqual([{ id: 'm', storagePath: 'ws/m.png' }]);
    expect(call.prompt).toMatch(/top-down/i);
    // Debe anclar a la imagen de referencia (respetar la maestra) e incluir la guía.
    expect(call.prompt).toMatch(/reference image/i);
    expect(call.prompt).toContain('a city sidewalk');
  });

  it('funciona sin guía (solo la maestra)', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: true, data: { generationId: 'gen1' } });
    vi.mocked(addGenerationAsReferenceAction).mockResolvedValue({
      ok: true,
      data: { id: 'ref1', previewUrl: 'p', storagePath: 's', filename: 'f.png' },
    });
    const res = await generateScaleMapFromMaster({ id: 'm', storagePath: 'ws/m.png' });
    expect(isGenError(res)).toBe(false);
    const call = vi.mocked(submitGenerationAction).mock.calls[0][0] as SubmitGenerationInput;
    expect(call.provider).toBe('nano-banana');
    expect(call.references).toEqual([{ id: 'm', storagePath: 'ws/m.png' }]);
  });
});

describe('retouchUploaded', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retoca una subida con guarda genérica (solo cambia lo pedido)', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: true, data: { generationId: 'gen1' } });
    vi.mocked(addGenerationAsReferenceAction).mockResolvedValue({
      ok: true,
      data: { id: 'ref1', previewUrl: 'p', storagePath: 's', filename: 'f.png' },
    });
    const res = await retouchUploaded({ id: 'up', storagePath: 'ws/up.png' }, 'remove the background');
    expect(isGenError(res)).toBe(false);
    const call = vi.mocked(submitGenerationAction).mock.calls[0][0] as SubmitGenerationInput;
    expect(call.provider).toBe('nano-banana');
    expect(call.references).toEqual([{ id: 'up', storagePath: 'ws/up.png' }]);
    expect(call.prompt).toContain('remove the background');
    expect(call.prompt).toMatch(/Keep everything else/i);
  });
});

// Vestuario por personaje (specs/v2/16): cuerpo completo ancla el vestuario
// desde la maestra head-and-shoulders; outfit varía SOLO la ropa desde ahí.
describe('generateFullBody', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pide cuerpo completo de la MISMA persona, pose neutra, vestuario visible', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: true, data: { generationId: 'gen1' } });
    vi.mocked(addGenerationAsReferenceAction).mockResolvedValue({
      ok: true,
      data: { id: 'ref1', previewUrl: 'p', storagePath: 's', filename: 'f.png' },
    });

    const res = await generateFullBody({ id: 'r1', storagePath: 'c/master.png' });

    expect(isGenError(res)).toBe(false);
    const call = vi.mocked(submitGenerationAction).mock.calls[0][0] as SubmitGenerationInput;
    expect(call.provider).toBe('nano-banana');
    expect((call as Extract<SubmitGenerationInput, { provider: 'nano-banana' }>).conversational).toBe(false);
    expect(call.references).toEqual([{ id: 'r1', storagePath: 'c/master.png' }]);
    expect(call.prompt).toMatch(/exact same person/i);
    expect(call.prompt).toMatch(/full-body/i);
    expect(call.prompt).toMatch(/head to shoes/i);
    expect(call.prompt).toMatch(/wardrobe reference/i);
  });

  it('propaga el error de la generación', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: false, error: 'provider_error', message: 'boom' });
    const res = await generateFullBody({ id: 'r1', storagePath: 'c/master.png' });
    expect(isGenError(res)).toBe(true);
    if (isGenError(res)) expect(res.message).toBe('boom');
  });
});

describe('generateOutfit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cambia SOLO la ropa, conserva identidad y pose', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: true, data: { generationId: 'gen1' } });
    vi.mocked(addGenerationAsReferenceAction).mockResolvedValue({
      ok: true,
      data: { id: 'ref1', previewUrl: 'p', storagePath: 's', filename: 'f.png' },
    });

    const res = await generateOutfit({ id: 'r2', storagePath: 'c/full.png' }, 'a red athletic tracksuit');

    expect(isGenError(res)).toBe(false);
    const call = vi.mocked(submitGenerationAction).mock.calls[0][0] as SubmitGenerationInput;
    expect(call.provider).toBe('nano-banana');
    expect((call as Extract<SubmitGenerationInput, { provider: 'nano-banana' }>).conversational).toBe(false);
    expect(call.references).toEqual([{ id: 'r2', storagePath: 'c/full.png' }]);
    expect(call.prompt).toMatch(/change only the clothing/i);
    expect(call.prompt).toContain('a red athletic tracksuit');
    expect(call.prompt).toMatch(/identical face, hairstyle, build/i);
  });

  it('propaga el error de la generación', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: false, error: 'provider_error', message: 'boom' });
    const res = await generateOutfit({ id: 'r2', storagePath: 'c/full.png' }, 'a red athletic tracksuit');
    expect(isGenError(res)).toBe(true);
    if (isGenError(res)) expect(res.message).toBe('boom');
  });
});
