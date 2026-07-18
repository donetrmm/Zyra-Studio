import { describe, expect, it } from 'vitest';
import { buildWizardKitOptions } from './wizard-kits';

const kit = (over: Partial<Parameters<typeof buildWizardKitOptions>[0][number]> = {}) => ({
  id: 'kit-1',
  name: 'Del celular a la pared',
  product_image_ids: [],
  packaging_image_ids: [],
  reference_image_ids: [],
  ...over,
});

describe('buildWizardKitOptions', () => {
  it('cuenta las imágenes de los productos V3 cuando el kit no tiene legacy', () => {
    // Bug 2026-07-14: kit V3 puro (sin imágenes legacy) con un producto de 2
    // imágenes mostraba "0 img producto" + aviso de kit sin productos.
    const options = buildWizardKitOptions(
      [kit()],
      { 'kit-1': [{ id: 'p1', name: 'Canvas 60×90', imageCount: 2 }] },
    );
    expect(options).toHaveLength(1);
    expect(options[0].productImages).toBe(2);
  });

  it('las imágenes legacy de producto tienen prioridad (mismo orden que el análisis)', () => {
    const options = buildWizardKitOptions(
      [kit({ product_image_ids: ['a', 'b', 'c'] })],
      { 'kit-1': [{ id: 'p1', name: 'P', imageCount: 1 }] },
    );
    expect(options[0].productImages).toBe(3);
  });

  it('cae a las referencias generales antes que a los productos V3', () => {
    const options = buildWizardKitOptions([kit({ reference_image_ids: ['a'] })], {
      'kit-1': [{ id: 'p1', name: 'P', imageCount: 5 }],
    });
    expect(options[0].productImages).toBe(1);
  });

  it('suma las imágenes de todos los productos del pool', () => {
    const options = buildWizardKitOptions([kit()], {
      'kit-1': [
        { id: 'p1', name: 'A', imageCount: 2 },
        { id: 'p2', name: 'B', imageCount: 3 },
      ],
    });
    expect(options[0].productImages).toBe(5);
  });

  it('excluye kits sin productos V3 y sin imágenes legacy', () => {
    const options = buildWizardKitOptions([kit()], {});
    expect(options).toHaveLength(0);
  });

  it('incluye kits con productos V3 aunque estos no tengan imágenes', () => {
    const options = buildWizardKitOptions([kit()], {
      'kit-1': [{ id: 'p1', name: 'Sin fotos', imageCount: 0 }],
    });
    expect(options).toHaveLength(1);
    expect(options[0].productImages).toBe(0);
  });

  it('cuenta el empaque desde el kit', () => {
    const options = buildWizardKitOptions(
      [kit({ packaging_image_ids: ['x', 'y'], reference_image_ids: ['a'] })],
      {},
    );
    expect(options[0].packagingImages).toBe(2);
  });
});
