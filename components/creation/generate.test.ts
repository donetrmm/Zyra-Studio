import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/server-actions/generations', () => ({ submitGenerationAction: vi.fn() }));
vi.mock('@/server-actions/media-references', () => ({ addGenerationAsReferenceAction: vi.fn() }));

import { submitGenerationAction } from '@/server-actions/generations';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import type { SubmitGenerationInput } from '@/lib/schemas/generations';
import { buildProductPrompt, generateProductAngle, generateCharacterState, isGenError, generateScaleMap, generateScaleMapFromMaster, refineCharacterMaster, refineLocationMaster, retouchUploaded, refineProductImage } from './generate';
import { stripSlop } from '@/lib/prompt-director/antislop';

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

// Concepto de producto con control desde la plataforma (feedback 2026-07-04):
// contexto de la toma + referencias de inspiración, no solo la descripción.
describe('buildProductPrompt', () => {
  it('estudio (default): packshot sobre fondo limpio', () => {
    const p = buildProductPrompt('una lata de té matcha');
    expect(p).toContain('una lata de té matcha');
    expect(p).toMatch(/Studio product photograph/);
    expect(p).toMatch(/no text, no watermark/i);
  });

  it('lifestyle: el producto en su contexto de uso, sin fondo de estudio', () => {
    const p = buildProductPrompt('una lata de té matcha', 'lifestyle');
    expect(p).toMatch(/real-world setting/);
    expect(p).not.toMatch(/seamless background/);
  });

  it('casero: foto de celular con balance neutro, sin lenguaje de estudio', () => {
    const p = buildProductPrompt('una lata de té matcha', 'casero');
    expect(p).toMatch(/smartphone/);
    expect(p).toMatch(/neutral white balance/);
    expect(p).not.toMatch(/Studio product photograph|professional/);
  });

  it('con referencias: instruye seguir su lenguaje de diseño (forma, logo, colores)', () => {
    const p = buildProductPrompt('una lata de té', 'estudio', 2);
    expect(p).toMatch(/reference images/);
    expect(p).toMatch(/logo or label/);
    expect(buildProductPrompt('una lata de té')).not.toMatch(/reference/i);
  });

  it('ningún contexto usa términos de la lista antislop', () => {
    for (const shot of ['estudio', 'lifestyle', 'casero'] as const) {
      expect(stripSlop(buildProductPrompt('x', shot, 1)).removed).toEqual([]);
    }
  });

  // Feedback 2026-07-04: controlar la dominante amarilla también en el concepto
  // de producto (estudio/lifestyle heredaban el warm-bias del generador).
  it('estudio y lifestyle piden balance neutro (anti-amarillo)', () => {
    expect(buildProductPrompt('una lata', 'estudio')).toMatch(/neutral white balance/);
    expect(buildProductPrompt('una lata', 'lifestyle')).toMatch(/neutral white balance/);
  });

  // Auditoría BD 2026-07-04: la descripción del producto no se saneaba (a
  // diferencia de locación/personaje) y la keyword soup reintroducía el look de IA.
  it('sanea la descripción del usuario (quita keyword soup y photorealistic)', () => {
    const p = buildProductPrompt('una lata de té, 8k, highly detailed, photorealistic');
    expect(p).toContain('una lata de té');
    expect(p).not.toMatch(/8k|highly detailed|photorealistic/i);
  });
});

// Refinado de maestras ya guardadas (feedback 2026-07-04): personaje y locación
// ganan la edición iterativa que antes solo tenía el producto.
describe('refineCharacterMaster', () => {
  beforeEach(() => vi.clearAllMocks());

  it('edita la maestra vía editUploaded preservando identidad, con la instrucción al mando', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: true, data: { generationId: 'gen1' } });
    vi.mocked(addGenerationAsReferenceAction).mockResolvedValue({
      ok: true,
      data: { id: 'ref1', previewUrl: 'p', storagePath: 's', filename: 'f.png' },
    });
    const res = await refineCharacterMaster({ id: 'm', storagePath: 'ws/m.png' }, 'shorter hair, denim jacket');
    expect(isGenError(res)).toBe(false);
    const call = vi.mocked(submitGenerationAction).mock.calls[0][0] as SubmitGenerationInput;
    expect(call.provider).toBe('nano-banana');
    expect((call as Extract<SubmitGenerationInput, { provider: 'nano-banana' }>).conversational).toBe(false);
    expect(call.references).toEqual([{ id: 'm', storagePath: 'ws/m.png' }]);
    expect(call.prompt).toContain('shorter hair, denim jacket');
    expect(call.prompt).toMatch(/same person identity/i);
    expect(call.prompt).toMatch(/master reference portrait/i);
    // El peinado NO va en la guarda de identidad: la instrucción debe poder cambiarlo.
    expect(call.prompt).not.toMatch(/same hairstyle/i);
  });
});

describe('refineLocationMaster', () => {
  beforeEach(() => vi.clearAllMocks());

  it('edita la maestra preservando el lugar (arquitectura y encuadre)', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: true, data: { generationId: 'gen1' } });
    vi.mocked(addGenerationAsReferenceAction).mockResolvedValue({
      ok: true,
      data: { id: 'ref1', previewUrl: 'p', storagePath: 's', filename: 'f.png' },
    });
    const res = await refineLocationMaster({ id: 'loc', storagePath: 'ws/loc.png' }, 'turn it to night time');
    expect(isGenError(res)).toBe(false);
    const call = vi.mocked(submitGenerationAction).mock.calls[0][0] as SubmitGenerationInput;
    expect(call.provider).toBe('nano-banana');
    expect(call.references).toEqual([{ id: 'loc', storagePath: 'ws/loc.png' }]);
    expect(call.prompt).toContain('turn it to night time');
    expect(call.prompt).toMatch(/same place|same architecture/i);
    expect(call.prompt).toMatch(/empty of people/i);
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

// Vistas de producto (feedback 2026-07-04): perfil 90° junto al 3/4, y retoque
// de cualquier vista preservando el producto.
describe('generateProductAngle — profile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rota el producto a perfil 90° con las mismas guardas que el 3/4', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: true, data: { generationId: 'gen1' } });
    vi.mocked(addGenerationAsReferenceAction).mockResolvedValue({
      ok: true,
      data: { id: 'ref1', previewUrl: 'p', storagePath: 's', filename: 'f.png' },
    });
    const res = await generateProductAngle({ id: 'src', storagePath: 'ws/src.png' }, 'profile');
    expect(isGenError(res)).toBe(false);
    const call = vi.mocked(submitGenerationAction).mock.calls[0][0] as SubmitGenerationInput;
    expect(call.provider).toBe('nano-banana');
    expect(call.references).toEqual([{ id: 'src', storagePath: 'ws/src.png' }]);
    expect(call.prompt).toMatch(/side profile view \(turned 90 degrees\)/i);
    expect(call.prompt).toMatch(/do NOT return the original/i);
    expect(call.prompt).toMatch(/Do not alter or invent any label text/i);
  });
});

describe('refineProductImage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aplica el cambio pedido con guarda de identidad del producto', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: true, data: { generationId: 'gen1' } });
    vi.mocked(addGenerationAsReferenceAction).mockResolvedValue({
      ok: true,
      data: { id: 'ref1', previewUrl: 'p', storagePath: 's', filename: 'f.png' },
    });
    const res = await refineProductImage({ id: 'v', storagePath: 'ws/v.png' }, 'fondo blanco puro');
    expect(isGenError(res)).toBe(false);
    const call = vi.mocked(submitGenerationAction).mock.calls[0][0] as SubmitGenerationInput;
    expect(call.references).toEqual([{ id: 'v', storagePath: 'ws/v.png' }]);
    expect(call.prompt).toContain('fondo blanco puro');
    expect(call.prompt).toMatch(/product identity perfectly consistent/i);
    expect(call.prompt).toMatch(/Do not alter or invent any label text/i);
  });
});
