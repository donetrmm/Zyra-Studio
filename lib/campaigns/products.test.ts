import { describe, it, expect } from 'vitest';
import { productInventoryFromRow, type ProductRow } from './products';
import { directorContextFor, type ItemRow, type CampaignContext } from './orchestrator';
import type { ProductInventory } from '@/lib/prompt-director/types';

const baseRow: ProductRow = {
  id: 'p1', workspace_id: 'w1', brand_id: 'b1', name: 'Canvas Familiar', slug: 'canvas-familiar',
  medium: 'canvas print', height_cm: 60, width_cm: 90, thickness_mm: 7, weight_kg: 3.5,
  visual_details: 'a family photo', palette: ['warm'], product_image_ids: ['i1'], packaging_image_ids: ['pk1'],
};

describe('productInventoryFromRow', () => {
  it('mapea la fila + paths resueltos a ProductInventory', () => {
    const inv = productInventoryFromRow(baseRow, {
      imagePaths: ['url/i1'], packagingImagePaths: ['url/pk1'], imageUsages: { 'url/i1': 'front' },
    });
    expect(inv.name).toBe('Canvas Familiar');
    expect(inv.medium).toBe('canvas print');
    expect(inv.heightCm).toBe(60);
    expect(inv.widthCm).toBe(90);
    expect(inv.thicknessMm).toBe(7);
    expect(inv.weightKg).toBe(3.5);
    expect(inv.visualDetails).toBe('a family photo');
    expect(inv.palette).toEqual(['warm']);
    expect(inv.imagePaths).toEqual(['url/i1']);
    expect(inv.imageUsages).toEqual({ 'url/i1': 'front' });
    expect(inv.packagingImagePaths).toEqual(['url/pk1']);
  });

  it('nulls → undefined (no ensucia el ProductInventory)', () => {
    const inv = productInventoryFromRow(
      { ...baseRow, medium: null, height_cm: null, width_cm: null, thickness_mm: null, weight_kg: null, visual_details: null, palette: null },
      { imagePaths: [] },
    );
    expect(inv.medium).toBeUndefined();
    expect(inv.heightCm).toBeUndefined();
    expect(inv.visualDetails).toBeUndefined();
    expect(inv.palette).toBeUndefined();
    expect(inv.imageUsages).toBeUndefined();
    expect(inv.packagingImagePaths).toBeUndefined();
  });

  it('name vacío → "the product" (paridad con directorContextFor)', () => {
    expect(productInventoryFromRow({ ...baseRow, name: '' }, { imagePaths: [] }).name).toBe('the product');
  });
});

function makeCtx(): CampaignContext {
  return {
    productName: 'Producto de Campaña', visualDetails: 'campaign details', palette: ['navy'],
    productImagePaths: ['url/campaign'], packagingImagePaths: [], productImageUsages: {},
    productHeightCm: 10, productWidthCm: 10, productMedium: 'mug', productThicknessMm: 2, productWeightKg: 0.3,
    characters: new Map(), language: 'es',
  };
}
function makeItem(): ItemRow {
  return {
    id: 'it1', campaign_id: 'c1', format_id: null, template_id: null, model_slug: 'seedance',
    duration_s: 8, aspect_ratio: '9:16', scene: null, audio: true, character_id: null, character_ids: null,
    reference_ids: null, scene_prompt: 'x', voice_tone: null, status: 'draft', sequence_id: null, scene_index: 0,
    location_id: null, storyboard_image_id: null, character_state_hint: null, character_outfit_hint: null,
    product_ids: null, reference_selection: null,
  };
}

describe('directorContextFor — productOverride', () => {
  const override: ProductInventory = { name: 'Producto del Clip', imagePaths: ['url/clip'], medium: 'canvas print' };

  it('sin override → usa el producto de campaña (comportamiento actual)', () => {
    const dc = directorContextFor(makeItem(), null, makeCtx());
    expect(dc.products?.[0]?.name).toBe('Producto de Campaña');
    expect(dc.products?.[0]?.imagePaths).toEqual(['url/campaign']);
  });

  it('con override → el producto del clip pisa al de campaña', () => {
    const dc = directorContextFor(makeItem(), null, makeCtx(), undefined, undefined, undefined, [override]);
    expect(dc.products?.[0]?.name).toBe('Producto del Clip');
    expect(dc.products?.[0]?.imagePaths).toEqual(['url/clip']);
    expect(dc.products?.[0]?.medium).toBe('canvas print');
  });
});
