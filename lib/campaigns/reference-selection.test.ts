import { describe, it, expect } from 'vitest';
import type { DirectorContext } from '@/lib/prompt-director';
import {
  normalizeReferenceSelection,
  applyReferenceSelection,
  buildReferencePool,
  buildReferencePoolTexts,
  CATEGORY_APPLIES,
} from './reference-selection';
import { compilePanel } from './storyboard';

const ctx: DirectorContext = {
  products: [
    {
      name: 'Cuadro',
      visualDetails: 'lienzo',
      palette: [],
      imagePaths: ['p/1.jpg', 'p/2.jpg', 'p/3.jpg', 'p/4.jpg'],
      imageUsages: { 'p/1.jpg': 'frontal' },
      packagingImagePaths: ['pk/1.jpg', 'pk/2.jpg'],
    },
  ],
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
    expect(out.products?.[0]?.imagePaths).toEqual(['p/2.jpg', 'p/4.jpg']);
    expect(out.products?.[0]?.packagingImagePaths).toEqual([]);
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
    expect(out.products?.[0]?.imagePaths).toEqual([]);
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
    expect(out.products).toBeUndefined();
  });
});

describe('buildReferencePool', () => {
  it('agrupa por categoría con labels, masters locked y default del recorte automático', () => {
    const pool = buildReferencePool({
      products: [
        {
          name: 'Cuadro',
          imagePaths: ctx.products![0].imagePaths,
          imageUsages: ctx.products![0].imageUsages,
          packagingImagePaths: ['pk/1.jpg', 'pk/2.jpg', 'pk/3.jpg'],
        },
      ],
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
    // El uso persistido viaja en la entrada (visible en el dialog sin re-analizar).
    expect(byPath.get('p/1.jpg')?.usage).toBe('frontal');
    expect(byPath.get('p/2.jpg')?.usage).toBeUndefined();
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

  it('composición con compilePanel: excluir producto lo quita de las refs del panel, el master del cast queda', () => {
    const filtered = applyReferenceSelection(ctx, { include: ['l/sala.jpg'] });
    const beat = { id: 'b1', scene_prompt: 'toma del producto', aspect_ratio: '9:16', storyboard_image_id: null };
    const compiled = compilePanel(beat, filtered, 'flux-2-pro-preview');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const roles = compiled.compiled.references.map((r) => r.role);
    expect(roles).not.toContain('product');
    expect(roles).toContain('character'); // master siempre viaja
    expect(compiled.compiled.references.some((r) => r.storagePath === 'l/sala.jpg')).toBe(true);
  });

  it('sin nombre de producto usa label genérico y deduplica paths repetidos', () => {
    const pool = buildReferencePool({
      products: [{ imagePaths: ['p/1.jpg', 'p/1.jpg'], packagingImagePaths: [] }],
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

  it('buildReferencePool etiqueta producto y empaque por nombre con 2+ productos', () => {
    const entries = buildReferencePool({
      products: [
        { name: 'Canvas Familiar', imagePaths: ['c1.png'], packagingImagePaths: ['cp1.png'] },
        { name: 'Retrato de Pareja', imagePaths: ['r1.png'], packagingImagePaths: [] },
      ],
      characters: [], locations: [], extraImagePaths: [],
    });
    expect(entries.find((e) => e.path === 'c1.png')?.label).toBe('Canvas Familiar');
    expect(entries.find((e) => e.path === 'r1.png')?.label).toBe('Retrato de Pareja');
    expect(entries.find((e) => e.path === 'cp1.png')?.label).toBe('Empaque — Canvas Familiar');
  });

  it('buildReferencePool multi marca autoIncluded según el cap por producto', () => {
    const entries = buildReferencePool({
      products: [
        { name: 'A', imagePaths: ['a1.png', 'a2.png', 'a3.png'], packagingImagePaths: [] },
        { name: 'B', imagePaths: ['b1.png'], packagingImagePaths: [] },
      ],
      characters: [], locations: [], extraImagePaths: [],
    });
    expect(entries.find((e) => e.path === 'a2.png')?.autoIncluded).toBe(true); // cap 2 con 2 productos
    expect(entries.find((e) => e.path === 'a3.png')?.autoIncluded).toBe(false);
  });
});

describe('CATEGORY_APPLIES — dónde viaja cada categoría (contrato del dialog)', () => {
  it('paneles solo usan producto, master del cast y locación; video usa todo', () => {
    expect(CATEGORY_APPLIES.product).toEqual({ video: true, panel: true });
    expect(CATEGORY_APPLIES.character_master).toEqual({ video: true, panel: true });
    expect(CATEGORY_APPLIES.location).toEqual({ video: true, panel: true });
    expect(CATEGORY_APPLIES.packaging.panel).toBe(false);
    expect(CATEGORY_APPLIES.character_angle.panel).toBe(false);
    expect(CATEGORY_APPLIES.scale_map.panel).toBe(false);
    expect(CATEGORY_APPLIES.extra.panel).toBe(false);
    expect(Object.values(CATEGORY_APPLIES).every((a) => a.video)).toBe(true);
  });
});

describe('buildReferencePoolTexts — las descripciones que anclan por texto', () => {
  it('producto con visualDetails, personajes con nombre y locaciones con descripción', () => {
    const texts = buildReferencePoolTexts({
      products: [{ name: 'Cuadro', visualDetails: 'lienzo con atardecer', imagePaths: ['p/1.jpg'] }],
      characters: [{ name: 'Ana', description: 'mujer de pelo negro, sonriente', masterImagePath: 'c/m.jpg' }],
      locations: [{ name: 'Sala', description: 'sala moderna con sofá gris' }],
    });
    expect(texts.products).toHaveLength(1);
    expect(texts.products[0].text).toContain('atardecer');
    expect(texts.characters).toHaveLength(1);
    expect(texts.characters[0].name).toBe('Ana');
    expect(texts.characters[0].text).toContain('Ana');
    expect(texts.locations).toEqual([{ name: 'Sala', description: 'sala moderna con sofá gris' }]);
  });

  it('sin producto ni cast devuelve vacíos sin tronar', () => {
    const texts = buildReferencePoolTexts({ products: [], characters: [], locations: [] });
    expect(texts.products).toEqual([]);
    expect(texts.characters).toEqual([]);
    expect(texts.locations).toEqual([]);
  });

  it('buildReferencePoolTexts devuelve una ficha por producto', () => {
    const texts = buildReferencePoolTexts({
      products: [
        { name: 'Canvas Familiar', imagePaths: [] },
        { name: 'Retrato de Pareja', imagePaths: [] },
      ],
      characters: [], locations: [],
    });
    expect(texts.products).toHaveLength(2);
    expect(texts.products[0].name).toBe('Canvas Familiar');
  });
});
