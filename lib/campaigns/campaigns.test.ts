import { describe, it, expect } from 'vitest';
import { buildPlan, type PlannerInput } from './planner';
import { estimatePlanCost, seedanceCostPerItem } from './estimate';
import type { PricingRow } from '@/lib/credits/types';

// ============ Fixtures ============

const FORMATS = [
  { slug: 'voz-cercana', refs: ['product', 'character'], d: 9 },
  { slug: 'a-pie-de-calle', refs: ['product', 'character'], d: 12 },
  { slug: 'manos-a-la-obra', refs: ['product'], d: 12 },
  { slug: 'el-descubrimiento', refs: ['product', 'packaging'], d: 10 },
  { slug: 'antes-y-despues', refs: ['product'], d: 8 },
  { slug: 'susurro', refs: ['product'], d: 10 },
  { slug: 'el-icono', refs: ['product'], d: 8 },
  { slug: 'gran-pantalla', refs: ['product'], d: 15 },
  { slug: 'mundo-imposible', refs: ['product'], d: 10 },
].map((f, i) => ({
  id: `fmt-${i}`,
  slug: f.slug,
  name: f.slug,
  requiredRefs: f.refs,
  defaultDurationS: f.d,
  defaultAudio: true,
}));

function plannerInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    totalItems: 12,
    category: 'beverage',
    productName: 'Lumen Sparkling Water',
    formats: FORMATS,
    scenes: [
      { name: 'Cocina', fragment: 'a sunlit home kitchen' },
      { name: 'Calle', fragment: 'a busy urban sidewalk' },
      { name: 'Estudio', fragment: 'a clean studio backdrop' },
      { name: 'Azotea', fragment: 'a city rooftop at dusk' },
    ],
    characters: [
      { id: 'char-1', name: 'Maya' },
      { id: 'char-2', name: 'Leo' },
    ],
    available: { product: true, packaging: false, character: true },
    dateStart: new Date('2026-07-01'),
    dateEnd: new Date('2026-07-30'),
    draftModelSlug: 'bytedance/seedance-2.0/fast/reference-to-video',
    ...overrides,
  };
}

// ============ Planner ============

describe('buildPlan', () => {
  it('reparte el total entre los formatos del mix de la categoría', () => {
    const items = buildPlan(plannerInput());
    expect(items).toHaveLength(12);
    // beverage: universal + susurro + a-pie-de-calle = 6 formatos viables
    const byFormat = new Map<string, number>();
    for (const i of items) byFormat.set(i.formatSlug, (byFormat.get(i.formatSlug) ?? 0) + 1);
    expect(byFormat.size).toBe(6);
    expect(byFormat.get('voz-cercana')).toBe(2);
    expect(byFormat.has('manos-a-la-obra')).toBe(false); // no es mix beverage
    expect(byFormat.has('el-descubrimiento')).toBe(false); // sin packaging
  });

  it('software excluye héroe físico y unboxing', () => {
    const items = buildPlan(plannerInput({ category: 'software', totalItems: 8 }));
    const slugs = new Set(items.map((i) => i.formatSlug));
    expect(slugs.has('el-icono')).toBe(false);
    expect(slugs.has('el-descubrimiento')).toBe(false);
    expect(slugs.has('manos-a-la-obra')).toBe(true);
  });

  it('sin Cast no propone formatos que exigen personaje', () => {
    const items = buildPlan(
      plannerInput({ available: { product: true, packaging: false, character: false }, characters: [] }),
    );
    const slugs = new Set(items.map((i) => i.formatSlug));
    expect(slugs.has('voz-cercana')).toBe(false);
    expect(slugs.has('a-pie-de-calle')).toBe(false);
    expect(items.length).toBe(12); // el total se reparte entre los viables
  });

  it('asigna personaje solo a formatos que lo requieren', () => {
    const items = buildPlan(plannerInput());
    for (const item of items) {
      const needsChar = ['voz-cercana', 'a-pie-de-calle'].includes(item.formatSlug);
      if (needsChar) expect(item.characterId).not.toBeNull();
      else expect(item.characterId).toBeNull();
    }
  });

  it('no repite escena+concepto dentro del mismo formato', () => {
    const items = buildPlan(plannerInput({ totalItems: 18 }));
    const byFormat = new Map<string, string[]>();
    for (const i of items) {
      const list = byFormat.get(i.formatSlug) ?? [];
      list.push(`${i.scene}::${i.scenePrompt}`);
      byFormat.set(i.formatSlug, list);
    }
    for (const combos of byFormat.values()) {
      expect(new Set(combos).size).toBe(combos.length);
    }
  });

  it('intercala formatos y reparte fechas dentro del rango', () => {
    const items = buildPlan(plannerInput());
    // intercalado: los primeros N items son de formatos distintos
    const firstSix = items.slice(0, 6).map((i) => i.formatSlug);
    expect(new Set(firstSix).size).toBe(6);
    // fechas dentro del rango y no decrecientes
    const dates = items.map((i) => i.scheduledDate);
    expect(dates[0]).toBe('2026-07-01');
    expect(dates[dates.length - 1] <= '2026-07-30').toBe(true);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  it('gran-pantalla en 16:9, el resto vertical', () => {
    const items = buildPlan(plannerInput({ totalItems: 18 }));
    for (const item of items) {
      expect(item.aspectRatio).toBe(item.formatSlug === 'gran-pantalla' ? '16:9' : '9:16');
    }
  });

  it('sin formatos viables devuelve vacío', () => {
    const items = buildPlan(
      plannerInput({ available: { product: false, packaging: false, character: false } }),
    );
    expect(items).toHaveLength(0);
  });
});

// ============ Estimador ============

const PRICING: PricingRow[] = [
  {
    provider: 'seedance',
    model_id: 'bytedance/seedance-2.0/fast/reference-to-video',
    variant: 'per_second_480p',
    credits_cost: 45,
    unit_size: 1,
    unit_label: 'segundo',
  },
  {
    provider: 'seedance',
    model_id: 'bytedance/seedance-2.0/reference-to-video',
    variant: 'per_second_720p',
    credits_cost: 100,
    unit_size: 1,
    unit_label: 'segundo',
  },
];

describe('estimate', () => {
  it('costo por item = duración × precio del tier', () => {
    expect(
      seedanceCostPerItem(PRICING, 'bytedance/seedance-2.0/fast/reference-to-video', '480p', 8),
    ).toBe(360);
    expect(
      seedanceCostPerItem(PRICING, 'bytedance/seedance-2.0/reference-to-video', '720p', 10),
    ).toBe(1000);
  });

  it('estimatePlanCost suma el lote en tier draft', () => {
    const { total, perItem } = estimatePlanCost(
      PRICING,
      [
        { modelSlug: 'bytedance/seedance-2.0/fast/reference-to-video', durationS: 8 },
        { modelSlug: 'bytedance/seedance-2.0/fast/reference-to-video', durationS: 10 },
      ],
      '480p',
    );
    expect(perItem).toEqual([360, 450]);
    expect(total).toBe(810);
  });

  it('pricing faltante lanza error claro', () => {
    expect(() =>
      seedanceCostPerItem(PRICING, 'bytedance/seedance-2.0/fast/reference-to-video', '1080p', 8),
    ).toThrow(/pricing no encontrado/);
  });
});
