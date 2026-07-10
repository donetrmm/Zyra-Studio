import { describe, it, expect } from 'vitest';
import {
  STUDIO_MODELS,
  variantControlFor,
  defaultVariantFor,
  resolveSelection,
  maxReferencesFor,
} from './model-options';

describe('STUDIO_MODELS', () => {
  it('ofrece 5 modelos (2 nano + 3 gpt-image)', () => {
    expect(STUDIO_MODELS.map((m) => m.key)).toEqual([
      'nano-pro',
      'nano-flash',
      'gpt-image-2',
      'gpt-image-1',
      'gpt-image-1-mini',
    ]);
  });
});

describe('variantControlFor', () => {
  it('nano-pro = resolución 1k/2k/4k', () => {
    expect(variantControlFor('nano-pro')).toEqual({ kind: 'resolution', options: ['1k', '2k', '4k'] });
  });
  it('nano-flash = resolución sin 4k', () => {
    expect(variantControlFor('nano-flash')).toEqual({ kind: 'resolution', options: ['1k', '2k'] });
  });
  it('gpt-image-2 = calidad baja/media/alta', () => {
    expect(variantControlFor('gpt-image-2')).toEqual({ kind: 'quality', options: ['low', 'medium', 'high'] });
  });
  it('gpt-image-1 y mini = sin control (variant fija)', () => {
    expect(variantControlFor('gpt-image-1')).toEqual({ kind: 'none' });
    expect(variantControlFor('gpt-image-1-mini')).toEqual({ kind: 'none' });
  });
});

describe('defaultVariantFor', () => {
  it('nano = 2k, gpt-image-2 = medium, resto = default', () => {
    expect(defaultVariantFor('nano-pro')).toBe('2k');
    expect(defaultVariantFor('nano-flash')).toBe('2k');
    expect(defaultVariantFor('gpt-image-2')).toBe('medium');
    expect(defaultVariantFor('gpt-image-1')).toBe('default');
    expect(defaultVariantFor('gpt-image-1-mini')).toBe('default');
  });
});

describe('resolveSelection', () => {
  it('nano-pro → gemini-3-pro-image-preview', () => {
    expect(resolveSelection('nano-pro', '2k')).toEqual({
      provider: 'nano-banana',
      model: 'gemini-3-pro-image-preview',
      variant: '2k',
    });
  });
  it('nano-flash → gemini-3.1-flash-image-preview', () => {
    expect(resolveSelection('nano-flash', '1k')).toEqual({
      provider: 'nano-banana',
      model: 'gemini-3.1-flash-image-preview',
      variant: '1k',
    });
  });
  it('gpt-image-2 → provider gpt-image, model gpt-image-2, variant = calidad', () => {
    expect(resolveSelection('gpt-image-2', 'high')).toEqual({
      provider: 'gpt-image',
      model: 'gpt-image-2',
      variant: 'high',
    });
  });
  it('gpt-image-1-mini → variant default', () => {
    expect(resolveSelection('gpt-image-1-mini', 'default')).toEqual({
      provider: 'gpt-image',
      model: 'gpt-image-1-mini',
      variant: 'default',
    });
  });
});

describe('maxReferencesFor', () => {
  it('gpt-image: 4 sin base, 3 con base (la base cuenta contra el tope de 4)', () => {
    expect(maxReferencesFor('gpt-image', false)).toBe(4);
    expect(maxReferencesFor('gpt-image', true)).toBe(3);
  });
  it('nano: 6 sin base, 5 con base (el schema limita referenceIds a 6)', () => {
    expect(maxReferencesFor('nano-banana', false)).toBe(6);
    expect(maxReferencesFor('nano-banana', true)).toBe(5);
  });
});
