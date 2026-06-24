import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/server-actions/generations', () => ({ submitGenerationAction: vi.fn() }));
vi.mock('@/server-actions/media-references', () => ({ addGenerationAsReferenceAction: vi.fn() }));

import { submitGenerationAction } from '@/server-actions/generations';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import type { SubmitGenerationInput } from '@/lib/schemas/generations';
import { generateProductAngle, isGenError } from './generate';

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
