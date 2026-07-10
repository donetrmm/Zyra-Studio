// components/studio/AttachDialog.test.ts
//
// mergeRole es la fusión pura de una nueva referencia en el rol de un
// StudioAssetImages (product | location | character). Un bug acá es pérdida
// de datos silenciosa (se pisa un campo que debía preservarse, o no se
// deduplica y el schema de personaje rompe con >2 ángulos). Se testea cada
// rama + los casos especiales (reemplazo vs. agregar+dedup, tope de ángulos).
import { describe, it, expect, vi } from 'vitest';

// AttachDialog.tsx importa 4 server actions con cadenas hacia Supabase/Next
// que no hace falta cargar para probar mergeRole (función pura, sin efectos).
// Se mockean para que el import del módulo no arrastre esas dependencias.
vi.mock('@/server-actions/media-references', () => ({ addGenerationAsReferenceAction: vi.fn() }));
vi.mock('@/server-actions/products', () => ({ setProductImagesAction: vi.fn() }));
vi.mock('@/server-actions/locations', () => ({ updateLocationAction: vi.fn() }));
vi.mock('@/server-actions/cast', () => ({ updateCharacterAction: vi.fn() }));

const { mergeRole } = await import('./AttachDialog');
import type { StudioAssetImages } from './types';

type ProductImages = Extract<StudioAssetImages, { assetType: 'product' }>;
type LocationImages = Extract<StudioAssetImages, { assetType: 'location' }>;
type CharacterImages = Extract<StudioAssetImages, { assetType: 'character' }>;

function productImages(overrides: Partial<ProductImages> = {}): ProductImages {
  return {
    assetType: 'product',
    productImageIds: ['ref-a'],
    packagingImageIds: ['ref-b'],
    ...overrides,
  };
}

function locationImages(overrides: Partial<LocationImages> = {}): LocationImages {
  return {
    assetType: 'location',
    name: 'Estudio principal',
    description: 'Fondo blanco con luz cenital',
    masterImageId: 'ref-master',
    referenceImageIds: ['ref-a'],
    scaleMapImageId: 'ref-scale',
    scaleMapNotes: 'Escala 1:1 respecto al producto',
    ...overrides,
  };
}

function characterImages(overrides: Partial<CharacterImages> = {}): CharacterImages {
  return {
    assetType: 'character',
    name: 'Vocera',
    description: 'Mujer adulta, cabello castaño',
    masterImageId: 'ref-master',
    angleImageIds: ['ref-a', 'ref-b'],
    fullBodyImageId: 'ref-full',
    voiceCloneId: 'voice-1',
    ...overrides,
  };
}

describe('mergeRole — product', () => {
  it('rol "product" agrega a productImageIds', () => {
    const images = productImages({ productImageIds: ['ref-a'] });
    const result = mergeRole(images, 'product', 'ref-new');
    expect('next' in result).toBe(true);
    if (!('next' in result)) throw new Error('esperaba next');
    expect(result.next.assetType).toBe('product');
    if (result.next.assetType !== 'product') throw new Error('narrowing');
    expect(result.next.productImageIds).toEqual(['ref-a', 'ref-new']);
    expect(result.next.packagingImageIds).toEqual(images.packagingImageIds); // no se toca
  });

  it('rol "product" hace dedup si el ref ya está', () => {
    const images = productImages({ productImageIds: ['ref-a', 'ref-new'] });
    const result = mergeRole(images, 'product', 'ref-new');
    if (!('next' in result)) throw new Error('esperaba next');
    if (result.next.assetType !== 'product') throw new Error('narrowing');
    expect(result.next.productImageIds).toEqual(['ref-a', 'ref-new']);
  });

  it('rol "packaging" agrega a packagingImageIds sin tocar productImageIds', () => {
    const images = productImages({ productImageIds: ['ref-a'], packagingImageIds: ['ref-b'] });
    const result = mergeRole(images, 'packaging', 'ref-new');
    if (!('next' in result)) throw new Error('esperaba next');
    if (result.next.assetType !== 'product') throw new Error('narrowing');
    expect(result.next.packagingImageIds).toEqual(['ref-b', 'ref-new']);
    expect(result.next.productImageIds).toEqual(['ref-a']);
  });
});

describe('mergeRole — location', () => {
  it('rol "master" reemplaza masterImageId y preserva el resto', () => {
    const images = locationImages({ masterImageId: 'ref-old-master' });
    const result = mergeRole(images, 'master', 'ref-new-master');
    if (!('next' in result)) throw new Error('esperaba next');
    if (result.next.assetType !== 'location') throw new Error('narrowing');
    expect(result.next.masterImageId).toBe('ref-new-master');
    expect(result.next.name).toBe(images.name);
    expect(result.next.description).toBe(images.description);
    expect(result.next.referenceImageIds).toEqual(images.referenceImageIds);
    expect(result.next.scaleMapImageId).toBe(images.scaleMapImageId);
    expect(result.next.scaleMapNotes).toBe(images.scaleMapNotes);
  });

  it('rol "scale_map" reemplaza scaleMapImageId y preserva el resto', () => {
    const images = locationImages({ scaleMapImageId: 'ref-old-scale' });
    const result = mergeRole(images, 'scale_map', 'ref-new-scale');
    if (!('next' in result)) throw new Error('esperaba next');
    if (result.next.assetType !== 'location') throw new Error('narrowing');
    expect(result.next.scaleMapImageId).toBe('ref-new-scale');
    expect(result.next.masterImageId).toBe(images.masterImageId);
    expect(result.next.referenceImageIds).toEqual(images.referenceImageIds);
    expect(result.next.name).toBe(images.name);
    expect(result.next.description).toBe(images.description);
    expect(result.next.scaleMapNotes).toBe(images.scaleMapNotes);
  });

  it('rol "reference" agrega+dedup a referenceImageIds y preserva el resto', () => {
    const images = locationImages({ referenceImageIds: ['ref-a'] });
    const result = mergeRole(images, 'reference', 'ref-new');
    if (!('next' in result)) throw new Error('esperaba next');
    if (result.next.assetType !== 'location') throw new Error('narrowing');
    expect(result.next.referenceImageIds).toEqual(['ref-a', 'ref-new']);

    const dedup = mergeRole(result.next, 'reference', 'ref-new');
    if (!('next' in dedup)) throw new Error('esperaba next');
    if (dedup.next.assetType !== 'location') throw new Error('narrowing');
    expect(dedup.next.referenceImageIds).toEqual(['ref-a', 'ref-new']); // sin duplicar
    expect(dedup.next.masterImageId).toBe(images.masterImageId);
    expect(dedup.next.scaleMapImageId).toBe(images.scaleMapImageId);
  });

  it('cualquier rol que no sea master/scale_map cae en referenceImageIds', () => {
    const images = locationImages({ referenceImageIds: [] });
    const result = mergeRole(images, 'algo-desconocido', 'ref-new');
    if (!('next' in result)) throw new Error('esperaba next');
    if (result.next.assetType !== 'location') throw new Error('narrowing');
    expect(result.next.referenceImageIds).toEqual(['ref-new']);
  });
});

describe('mergeRole — character', () => {
  it('rol "master" reemplaza masterImageId y preserva el resto', () => {
    const images = characterImages({ masterImageId: 'ref-old-master' });
    const result = mergeRole(images, 'master', 'ref-new-master');
    if (!('next' in result)) throw new Error('esperaba next');
    if (result.next.assetType !== 'character') throw new Error('narrowing');
    expect(result.next.masterImageId).toBe('ref-new-master');
    expect(result.next.angleImageIds).toEqual(images.angleImageIds);
    expect(result.next.fullBodyImageId).toBe(images.fullBodyImageId);
    expect(result.next.voiceCloneId).toBe(images.voiceCloneId);
    expect(result.next.description).toBe(images.description);
    expect(result.next.name).toBe(images.name);
  });

  it('rol "full_body" reemplaza fullBodyImageId y preserva el resto', () => {
    const images = characterImages({ fullBodyImageId: 'ref-old-full' });
    const result = mergeRole(images, 'full_body', 'ref-new-full');
    if (!('next' in result)) throw new Error('esperaba next');
    if (result.next.assetType !== 'character') throw new Error('narrowing');
    expect(result.next.fullBodyImageId).toBe('ref-new-full');
    expect(result.next.masterImageId).toBe(images.masterImageId);
    expect(result.next.angleImageIds).toEqual(images.angleImageIds);
    expect(result.next.voiceCloneId).toBe(images.voiceCloneId);
    expect(result.next.description).toBe(images.description);
    expect(result.next.name).toBe(images.name);
  });

  it('rol "angle" agrega+dedup a angleImageIds cuando hay espacio (<2)', () => {
    const images = characterImages({ angleImageIds: ['ref-a'] });
    const result = mergeRole(images, 'angle', 'ref-new');
    if (!('next' in result)) throw new Error('esperaba next');
    if (result.next.assetType !== 'character') throw new Error('narrowing');
    expect(result.next.angleImageIds).toEqual(['ref-a', 'ref-new']);
    expect(result.next.masterImageId).toBe(images.masterImageId);
    expect(result.next.fullBodyImageId).toBe(images.fullBodyImageId);
    expect(result.next.voiceCloneId).toBe(images.voiceCloneId);
  });

  it('tope de ángulos: con 2 ángulos, un ángulo NUEVO devuelve error y no persiste', () => {
    const images = characterImages({ angleImageIds: ['ref-a', 'ref-b'] });
    const result = mergeRole(images, 'angle', 'ref-nuevo-tercero');
    expect('error' in result).toBe(true);
    if (!('error' in result)) throw new Error('esperaba error');
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
  });

  it('tope de ángulos: re-adjuntar un ángulo YA presente no da error y mantiene 2 (dedup)', () => {
    const images = characterImages({ angleImageIds: ['ref-a', 'ref-b'] });
    const result = mergeRole(images, 'angle', 'ref-a');
    if (!('next' in result)) throw new Error('esperaba next, no error');
    if (result.next.assetType !== 'character') throw new Error('narrowing');
    expect(result.next.angleImageIds).toEqual(['ref-a', 'ref-b']);
    expect(result.next.angleImageIds).toHaveLength(2);
  });
});
