import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/server-actions/generations', () => ({ submitGenerationAction: vi.fn() }));
vi.mock('@/server-actions/media-references', () => ({ addGenerationAsReferenceAction: vi.fn() }));

import { submitGenerationAction } from '@/server-actions/generations';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import type { SubmitGenerationInput } from '@/lib/schemas/generations';
import { generateProductAngle, generateCharacterState, isGenError, generateScaleMap } from './generate';

describe('generateProductAngle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rota el producto a 3/4 vía Nano Banana (editUploaded) con prompt de producto', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: true, data: { generationId: 'gen1' } });
    vi.mocked(addGenerationAsReferenceAction).mockResolvedValue({
      ok: true,
      data: { id: 'ref1', previewUrl: 'prev', storagePath: 'ws/ref1.png', filename: 'ref1.png' },
    });

    const res = await generateProductAngle({ id: 'src', storagePath: 'ws/src.png' }, 'three-quarter');

    expect(isGenError(res)).toBe(false);
    if (!isGenError(res)) expect(res.refId).toBe('ref1');

    const call = vi.mocked(submitGenerationAction).mock.calls[0][0] as SubmitGenerationInput;
    expect(call.provider).toBe('nano-banana');
    expect((call as Extract<SubmitGenerationInput, { provider: 'nano-banana' }>).conversational).toBe(false); // editUploaded: la foto va como referencia, no como parent
    expect(call.references).toEqual([{ id: 'src', storagePath: 'ws/src.png' }]);
    expect(call.prompt).toMatch(/three-quarter/i);
    expect(call.prompt).toMatch(/Do not alter or invent any label text/i);
  });

  it('propaga el error de la generación', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: false, error: 'provider_error', message: 'boom' });
    const res = await generateProductAngle({ id: 'src', storagePath: 'ws/src.png' }, 'three-quarter');
    expect(isGenError(res)).toBe(true);
    if (isGenError(res)) expect(res.message).toBe('boom');
  });
});

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
