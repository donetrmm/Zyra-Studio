import { describe, it, expect } from 'vitest';
import type { DirectorContext } from '@/lib/prompt-director';
import {
  normalizeReferenceSelection,
  applyReferenceSelection,
  buildReferencePool,
} from './reference-selection';

const ctx: DirectorContext = {
  product: {
    name: 'Cuadro',
    visualDetails: 'lienzo',
    palette: [],
    imagePaths: ['p/1.jpg', 'p/2.jpg', 'p/3.jpg', 'p/4.jpg'],
    imageUsages: { 'p/1.jpg': 'frontal' },
    packagingImagePaths: ['pk/1.jpg', 'pk/2.jpg'],
  },
  characters: [
    {
      name: 'Ana',
      description: 'mujer de pelo negro',
      masterImagePath: 'c/ana-master.jpg',
      angleImagePaths: ['c/ana-a1.jpg', 'c/ana-a2.jpg'],
    },
  ],
  location: {
    name: 'Sala',
    description: 'sala moderna',
    imagePaths: ['l/sala.jpg'],
    scaleMap: { path: 'l/sala-map.jpg', notes: 'sofá 2m' },
  },
  extraImagePaths: ['x/extra.jpg'],
  language: 'es',
};

describe('normalizeReferenceSelection', () => {
  it.each([
    { raw: null, expected: null },
    { raw: undefined, expected: null },
    { raw: 'basura', expected: null },
    { raw: {}, expected: null },
    { raw: { include: [] }, expected: null },
    { raw: { include: [42, null] }, expected: null },
    { raw: { include: ['p/1.jpg', ''] }, expected: { include: ['p/1.jpg'] } },
    { raw: { include: ['a', 'b'] }, expected: { include: ['a', 'b'] } },
  ])('normaliza $raw', ({ raw, expected }) => {
    expect(normalizeReferenceSelection(raw)).toEqual(expected);
  });
});

describe('applyReferenceSelection', () => {
  it('sin selección devuelve el MISMO contexto (sin manualRefs)', () => {
    const out = applyReferenceSelection(ctx, null);
    expect(out).toBe(ctx);
    expect(out.manualRefs).toBeUndefined();
  });

  it('filtra producto/empaque/ángulos/locación/extras a lo incluido y marca manualRefs', () => {
    const out = applyReferenceSelection(ctx, {
      include: ['p/2.jpg', 'p/4.jpg', 'c/ana-a2.jpg', 'l/sala.jpg'],
    });
    expect(out.manualRefs).toBe(true);
    expect(out.product?.imagePaths).toEqual(['p/2.jpg', 'p/4.jpg']);
    expect(out.product?.packagingImagePaths).toEqual([]);
    expect(out.characters?.[0].angleImagePaths).toEqual(['c/ana-a2.jpg']);
    expect(out.location?.imagePaths).toEqual(['l/sala.jpg']);
    expect(out.location?.scaleMap).toBeUndefined();
    expect(out.extraImagePaths).toBeUndefined();
  });

  it('la hoja maestra del cast SIEMPRE viaja aunque no esté en include', () => {
    const out = applyReferenceSelection(ctx, { include: ['p/1.jpg'] });
    expect(out.characters?.[0].masterImagePath).toBe('c/ana-master.jpg');
    expect(out.characters?.[0].name).toBe('Ana');
  });

  it('el mapa de escala viaja solo si su path está incluido', () => {
    const out = applyReferenceSelection(ctx, { include: ['l/sala-map.jpg'] });
    expect(out.location?.scaleMap).toEqual({ path: 'l/sala-map.jpg', notes: 'sofá 2m' });
    expect(out.location?.imagePaths).toEqual([]);
  });

  it('paths stale (brand kit editado) filtran a no-op sin romper', () => {
    const out = applyReferenceSelection(ctx, { include: ['ya-no-existe.jpg'] });
    expect(out.product?.imagePaths).toEqual([]);
    expect(out.characters?.[0].masterImagePath).toBe('c/ana-master.jpg');
  });

  it('la locación conserva nombre/descripción aunque sus imágenes se excluyan', () => {
    const out = applyReferenceSelection(ctx, { include: ['p/1.jpg'] });
    expect(out.location?.name).toBe('Sala');
    expect(out.location?.description).toBe('sala moderna');
  });

  it('sin producto/personajes/locación en el ctx no truena', () => {
    const minimal: DirectorContext = { language: 'es' };
    const out = applyReferenceSelection(minimal, { include: ['a'] });
    expect(out.manualRefs).toBe(true);
    expect(out.product).toBeUndefined();
  });
});

describe('buildReferencePool', () => {
  it('agrupa por categoría con labels, masters locked y default del recorte automático', () => {
    const pool = buildReferencePool({
      product: { name: 'Cuadro', imagePaths: ctx.product!.imagePaths, imageUsages: ctx.product!.imageUsages },
      packagingImagePaths: ['pk/1.jpg', 'pk/2.jpg', 'pk/3.jpg'],
      characters: [
        { name: 'Ana', masterImagePath: 'c/ana-master.jpg', angleImagePaths: ['c/ana-a1.jpg', 'c/ana-a2.jpg', 'c/ana-a3.jpg'] },
      ],
      locations: [{ name: 'Sala', imagePaths: ['l/sala.jpg'], scaleMap: { path: 'l/sala-map.jpg' } }],
      extraImagePaths: ['x/extra.jpg'],
    });
    const byPath = new Map(pool.map((e) => [e.path, e]));

    // Producto: los primeros 3 entran por default (tope automático), el 4to no.
    expect(byPath.get('p/1.jpg')).toMatchObject({ category: 'product', autoIncluded: true, label: 'Cuadro — frontal' });
    expect(byPath.get('p/4.jpg')).toMatchObject({ category: 'product', autoIncluded: false });
    // Empaque: tope automático 2.
    expect(byPath.get('pk/2.jpg')?.autoIncluded).toBe(true);
    expect(byPath.get('pk/3.jpg')?.autoIncluded).toBe(false);
    // Master locked; ángulos con default del mejor caso (2).
    expect(byPath.get('c/ana-master.jpg')).toMatchObject({ category: 'character_master', locked: true, autoIncluded: true });
    expect(byPath.get('c/ana-a2.jpg')?.autoIncluded).toBe(true);
    expect(byPath.get('c/ana-a3.jpg')?.autoIncluded).toBe(false);
    // Locación y mapa de escala por default.
    expect(byPath.get('l/sala.jpg')).toMatchObject({ category: 'location', autoIncluded: true, label: 'Sala' });
    expect(byPath.get('l/sala-map.jpg')?.category).toBe('scale_map');
    expect(byPath.get('x/extra.jpg')?.category).toBe('extra');
  });

  it('sin nombre de producto usa label genérico y deduplica paths repetidos', () => {
    const pool = buildReferencePool({
      product: { imagePaths: ['p/1.jpg', 'p/1.jpg'] },
      packagingImagePaths: [],
      characters: [],
      locations: [
        { name: 'Sala', imagePaths: ['l/sala.jpg'] },
        { name: 'Sala bis', imagePaths: ['l/sala.jpg'] },
      ],
      extraImagePaths: [],
    });
    expect(pool.filter((e) => e.path === 'p/1.jpg')).toHaveLength(1);
    expect(pool.filter((e) => e.path === 'l/sala.jpg')).toHaveLength(1);
    expect(pool.find((e) => e.path === 'p/1.jpg')?.label).toBe('Producto');
  });
});
