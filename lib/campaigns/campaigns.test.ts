import { describe, it, expect } from 'vitest';
import {
  buildDirectedPlan,
  buildPlan,
  MAX_PLAN_ITEMS,
  type DirectedPlanInput,
  type PlannerInput,
} from './planner';
import { buildCaption, productHashtag } from './captions';
import { htmlToText, isPrivateIp } from './brief';
import { estimatePlanCost, seedanceCostPerItem } from './estimate';
import { buildSeries, buildTemplateParams } from './distill';
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
    goal: 'mixed',
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

// ============ Plan dirigido por ideas ============

const fmt = (slug: string) => {
  const f = FORMATS.find((x) => x.slug === slug);
  if (!f) throw new Error(`fixture sin formato ${slug}`);
  return f;
};

function directedInput(
  ideas: DirectedPlanInput['ideas'],
  overrides: Partial<DirectedPlanInput> = {},
): DirectedPlanInput {
  const base = plannerInput();
  return {
    ideas,
    productName: base.productName,
    goal: base.goal,
    scenes: base.scenes,
    characters: base.characters,
    available: base.available,
    dateStart: base.dateStart,
    dateEnd: base.dateEnd,
    draftModelSlug: base.draftModelSlug,
    ...overrides,
  };
}

describe('buildDirectedPlan', () => {
  it('genera exactamente los creativos pedidos, sin rellenar', () => {
    const items = buildDirectedPlan(
      directedInput([
        { format: fmt('el-icono'), count: 1, scenePrompt: null },
        { format: fmt('susurro'), count: 3, scenePrompt: null },
      ]),
    );
    expect(items).toHaveLength(4);
    const bySlug = new Map<string, number>();
    for (const i of items) bySlug.set(i.formatSlug, (bySlug.get(i.formatSlug) ?? 0) + 1);
    expect(bySlug.get('el-icono')).toBe(1);
    expect(bySlug.get('susurro')).toBe(3);
  });

  it('el scenePrompt del matcher manda sobre las semillas del formato', () => {
    const items = buildDirectedPlan(
      directedInput([
        {
          format: fmt('mundo-imposible'),
          count: 1,
          scenePrompt: 'A dog carries the product through a park, tail wagging',
        },
      ]),
    );
    expect(items[0].scenePrompt).toBe('A dog carries the product through a park, tail wagging');
  });

  it('sin scenePrompt usa las semillas del formato', () => {
    const items = buildDirectedPlan(
      directedInput([{ format: fmt('el-icono'), count: 2, scenePrompt: null }]),
    );
    for (const item of items) {
      expect(item.scenePrompt.length).toBeGreaterThan(20);
      expect(item.scenePrompt).toContain('Lumen Sparkling Water');
    }
    // semillas distintas por variación
    expect(items[0].scenePrompt).not.toBe(items[1].scenePrompt);
  });

  it('filtra ideas cuyos formatos requieren referencias que faltan', () => {
    const items = buildDirectedPlan(
      directedInput(
        [
          { format: fmt('voz-cercana'), count: 2, scenePrompt: null },
          { format: fmt('el-icono'), count: 1, scenePrompt: null },
        ],
        { available: { product: true, packaging: false, character: false }, characters: [] },
      ),
    );
    expect(items).toHaveLength(1);
    expect(items[0].formatSlug).toBe('el-icono');
  });

  it('devuelve vacío si ninguna idea es viable', () => {
    const items = buildDirectedPlan(
      directedInput(
        [{ format: fmt('el-descubrimiento'), count: 1, scenePrompt: null }],
        { available: { product: true, packaging: false, character: true } },
      ),
    );
    expect(items).toHaveLength(0);
  });

  it('aplica el techo demo de 30 creativos en total', () => {
    const items = buildDirectedPlan(
      directedInput([
        { format: fmt('el-icono'), count: 10, scenePrompt: null },
        { format: fmt('susurro'), count: 10, scenePrompt: null },
        { format: fmt('gran-pantalla'), count: 10, scenePrompt: null },
        { format: fmt('antes-y-despues'), count: 10, scenePrompt: null },
      ]),
    );
    expect(items).toHaveLength(MAX_PLAN_ITEMS);
  });

  it('asigna personaje, aspect ratio y fechas como el plan por mix', () => {
    const items = buildDirectedPlan(
      directedInput([
        { format: fmt('voz-cercana'), count: 2, scenePrompt: null },
        { format: fmt('gran-pantalla'), count: 1, scenePrompt: null },
      ]),
    );
    for (const item of items) {
      if (item.formatSlug === 'voz-cercana') {
        expect(item.characterId).not.toBeNull();
        expect(item.aspectRatio).toBe('9:16');
      } else {
        expect(item.characterId).toBeNull();
        expect(item.aspectRatio).toBe('16:9');
      }
      expect(item.scheduledDate >= '2026-07-01').toBe(true);
      expect(item.scheduledDate <= '2026-07-30').toBe(true);
    }
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

// ============ Plantillas vivas (Fase D) ============

describe('distill', () => {
  const fixed = buildTemplateParams({
    modelSlug: 'bytedance/seedance-2.0/reference-to-video',
    durationS: 9,
    aspectRatio: '9:16',
    resolution: '720p',
    audio: true,
    templateVideoPath: 'ws1/u1/template-abc.mp4',
  });

  it('buildTemplateParams aplica defaults sin pisar valores', () => {
    expect(fixed.durationS).toBe(9);
    expect(fixed.templateVideoPath).toBe('ws1/u1/template-abc.mp4');
    const withDefaults = buildTemplateParams({
      modelSlug: 'm',
      durationS: null,
      aspectRatio: null,
      resolution: null,
      audio: false,
      templateVideoPath: 'p.mp4',
    });
    expect(withDefaults.durationS).toBe(8);
    expect(withDefaults.aspectRatio).toBe('9:16');
    expect(withDefaults.resolution).toBe('720p');
  });

  const slots = {
    scenePrompt: 'She lifts the can and smiles',
    scene: 'a sunlit home kitchen',
    characterId: 'char-1',
    productName: 'Lumen',
  };
  const scenes = [
    { name: 'Cocina', fragment: 'a sunlit home kitchen' },
    { name: 'Calle', fragment: 'a busy urban sidewalk' },
    { name: 'Azotea', fragment: 'a city rooftop at dusk' },
  ];

  it('buildSeries excluye la escena original y conserva la accion', () => {
    const items = buildSeries({
      templateId: 'tpl-1',
      formatId: 'fmt-0',
      fixed,
      slots,
      count: 4,
      scenes,
      characters: [],
      rotateCharacters: false,
      startDate: new Date('2026-07-01'),
    });
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(item.scene).not.toBe('a sunlit home kitchen');
      expect(item.scenePrompt).toBe(slots.scenePrompt);
      expect(item.templateId).toBe('tpl-1');
      expect(item.characterId).toBe('char-1'); // sin rotacion conserva el original
      expect(item.durationS).toBe(9);
    }
    expect(items[0].scheduledDate).toBe('2026-07-01');
    expect(items[3].scheduledDate).toBe('2026-07-04');
  });

  it('buildSeries rota personajes cuando se pide', () => {
    const items = buildSeries({
      templateId: 'tpl-1',
      formatId: 'fmt-0',
      fixed,
      slots,
      count: 4,
      scenes,
      characters: [
        { id: 'char-1', name: 'Maya' },
        { id: 'char-2', name: 'Leo' },
      ],
      rotateCharacters: true,
      startDate: new Date('2026-07-01'),
    });
    const used = new Set(items.map((i) => i.characterId));
    expect(used).toEqual(new Set(['char-1', 'char-2']));
  });

  it('buildSeries sin escenas devuelve vacio', () => {
    const items = buildSeries({
      templateId: 'tpl-1',
      formatId: null,
      fixed,
      slots,
      count: 3,
      scenes: [],
      characters: [],
      rotateCharacters: false,
      startDate: new Date(),
    });
    expect(items).toHaveLength(0);
  });
});

// ============ Captions ============

describe('buildCaption', () => {
  it('arma gancho + CTA + hashtags y rota por index', () => {
    const a = buildCaption({ productName: 'Lumen', formatSlug: 'voz-cercana', goal: 'conversion', index: 0 });
    const b = buildCaption({ productName: 'Lumen', formatSlug: 'voz-cercana', goal: 'conversion', index: 1 });
    expect(a).toContain('Lumen');
    expect(a).toContain('#lumen');
    expect(a).toContain('link en bio');
    expect(a).not.toBe(b); // gancho/CTA rotan dentro del formato
  });

  it('CTA depende del objetivo', () => {
    const conv = buildCaption({ productName: 'Lumen', formatSlug: 'el-icono', goal: 'conversion', index: 0 });
    const awar = buildCaption({ productName: 'Lumen', formatSlug: 'el-icono', goal: 'awareness', index: 0 });
    expect(conv).toContain('Disponible ahora');
    expect(awar).not.toContain('Disponible ahora');
  });

  it('formato desconocido usa ganchos genéricos sin romper', () => {
    const c = buildCaption({ productName: 'Lumen', formatSlug: 'mi-formato-custom', goal: 'mixed', index: 0 });
    expect(c).toContain('Lumen');
    expect(c.length).toBeGreaterThan(10);
    expect(c.length).toBeLessThanOrEqual(2200);
  });

  it('productHashtag normaliza acentos y símbolos', () => {
    expect(productHashtag('Café Olla 3000')).toBe('#cafeolla3000');
    expect(productHashtag('!!!')).toBe('');
  });
});

describe('isPrivateIp (guarda SSRF del brief por URL)', () => {
  it('bloquea loopback, privadas, link-local, ULA y mapeadas', () => {
    const blocked = [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.5',
      'no-es-ip',
    ];
    for (const ip of blocked) expect(isPrivateIp(ip), ip).toBe(true);
  });

  it('permite IPs públicas', () => {
    const allowed = ['8.8.8.8', '172.15.0.1', '172.32.0.1', '104.18.32.1', '2606:4700::1111'];
    for (const ip of allowed) expect(isPrivateIp(ip), ip).toBe(false);
  });
});

describe('htmlToText', () => {
  it('extrae título, meta description y texto sin scripts ni tags', () => {
    const html = `<html><head><title>Agua Lumen 600ml</title>
      <meta name="description" content="Agua mineral con gas, botella de vidrio">
      <style>.x{color:red}</style><script>alert(1)</script></head>
      <body><h1>Lumen</h1><p>Burbujas finas, origen volcánico.</p></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain('Agua Lumen 600ml');
    expect(text).toContain('botella de vidrio');
    expect(text).toContain('origen volcánico');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('<h1>');
  });

  it('acota la salida a 4000 caracteres', () => {
    const text = htmlToText(`<body>${'palabra '.repeat(2000)}</body>`);
    expect(text.length).toBeLessThanOrEqual(4000);
  });
});

describe('buildPlan formatos custom', () => {
  it('un formato custom del workspace entra al mix con semillas genéricas', () => {
    const custom = {
      id: 'fmt-custom',
      slug: 'mi-formato',
      name: 'Mi Formato',
      requiredRefs: ['product'],
      defaultDurationS: 6,
      defaultAudio: true,
    };
    const items = buildPlan(plannerInput({ formats: [...FORMATS, custom], totalItems: 14 }));
    const ofCustom = items.filter((i) => i.formatSlug === 'mi-formato');
    expect(ofCustom.length).toBeGreaterThan(0);
    expect(ofCustom[0].scenePrompt).toContain('Lumen');
    expect(ofCustom[0].caption).toBeTruthy();
  });
});

describe('buildPlan aprendizaje', () => {
  it('un formato con ganadores recibe doble peso en el reparto', () => {
    // beverage viable sin packaging: 6 formatos. Pesos: el-icono 2, resto 1 → 7.
    // 14 items: el-icono 14*2/7 = 4; los demás 14*1/7 = 2.
    const items = buildPlan(plannerInput({ totalItems: 14, winningSlugs: ['el-icono'] }));
    const byFormat = new Map<string, number>();
    for (const i of items) byFormat.set(i.formatSlug, (byFormat.get(i.formatSlug) ?? 0) + 1);
    expect(items).toHaveLength(14);
    expect(byFormat.get('el-icono')).toBe(4);
    expect(byFormat.get('voz-cercana')).toBe(2);
  });

  it('sin ganadores el reparto queda parejo (comportamiento original)', () => {
    const items = buildPlan(plannerInput({ totalItems: 12 }));
    const byFormat = new Map<string, number>();
    for (const i of items) byFormat.set(i.formatSlug, (byFormat.get(i.formatSlug) ?? 0) + 1);
    for (const count of byFormat.values()) expect(count).toBe(2);
  });
});

describe('buildPlan captions', () => {
  it('todo item del plan lleva caption con el producto', () => {
    const items = buildPlan(plannerInput());
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i.caption).toBeTruthy();
      expect(i.caption).toContain('Lumen');
    }
  });
});
