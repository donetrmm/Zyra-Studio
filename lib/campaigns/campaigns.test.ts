import { describe, it, expect } from 'vitest';
import {
  buildDirectedPlan,
  buildPlan,
  MAX_PLAN_ITEMS,
  DEFAULT_PRESENTER,
  type DirectedPlanInput,
  type PlannerInput,
  type PlannerFormat,
} from './planner';
import { buildCaption, productHashtag } from './captions';
import { htmlToText, isPrivateIp } from './brief';
import { estimatePlanCost, seedanceCostPerItem } from './estimate';
import { buildSeries, buildTemplateParams } from './distill';
import type { PricingRow } from '@/lib/credits/types';
import { MergeSequenceSchema } from '@/lib/schemas/campaigns';
import { mergeScenes } from '@/lib/campaigns/merge';

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
    available: { product: true, packaging: false },
    dateStart: new Date('2026-07-01'),
    dateEnd: new Date('2026-07-30'),
    draftModelSlug: 'bytedance/seedance-2.0/fast/reference-to-video',
    language: 'es',
    aspectRatio: '9:16',
    ...overrides,
  };
}

// Helper: busca en FORMATS si no se pasan refs; crea formato ad-hoc si se pasan.
const fmt = (slug: string, refs?: string[]): PlannerFormat => {
  if (refs !== undefined) {
    return {
      id: `id-${slug}`,
      slug,
      name: slug,
      requiredRefs: refs,
      defaultDurationS: 8,
      defaultAudio: true,
    };
  }
  const f = FORMATS.find((x) => x.slug === slug);
  if (!f) throw new Error(`fixture sin formato ${slug}`);
  return f;
};

// Helper unificado para DirectedPlanInput. Acepta Partial con `ideas` incluida.
function directedInput(over: Partial<DirectedPlanInput> = {}): DirectedPlanInput {
  const base = plannerInput();
  return {
    ideas: [],
    productName: base.productName,
    goal: base.goal,
    scenes: base.scenes,
    characters: base.characters,
    available: base.available,
    dateStart: base.dateStart,
    dateEnd: base.dateEnd,
    draftModelSlug: base.draftModelSlug,
    language: base.language,
    aspectRatio: base.aspectRatio,
    ...over,
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

  it('sin packaging no propone formatos que exigen packaging', () => {
    // beauty SÍ incluye el-descubrimiento en su mix (requiredRefs: ['product','packaging']).
    // Con packaging:false el filtro formatFitsRefs lo debe excluir; con packaging:true aparece.
    const withoutPkg = buildPlan(
      plannerInput({ category: 'beauty', available: { product: true, packaging: false } }),
    );
    expect(withoutPkg.map((i) => i.formatSlug)).not.toContain('el-descubrimiento');
    expect(withoutPkg.length).toBe(12); // el total se reparte entre los viables

    const withPkg = buildPlan(
      plannerInput({ category: 'beauty', available: { product: true, packaging: true } }),
    );
    expect(withPkg.map((i) => i.formatSlug)).toContain('el-descubrimiento');
  });

  it('asigna personajes solo a formatos que los requieren', () => {
    const items = buildPlan(plannerInput());
    for (const item of items) {
      const needsChar = ['voz-cercana', 'a-pie-de-calle'].includes(item.formatSlug);
      if (needsChar) expect(item.characterIds.length).toBeGreaterThan(0);
      else expect(item.characterIds).toEqual([]);
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

  it('el formato de video de la campaña aplica a todos los items (034)', () => {
    // La elección explícita del usuario manda: sin excepciones por slug.
    const vertical = buildPlan(plannerInput({ totalItems: 18 }));
    for (const item of vertical) expect(item.aspectRatio).toBe('9:16');

    const horizontal = buildPlan(plannerInput({ totalItems: 6, aspectRatio: '16:9' }));
    for (const item of horizontal) expect(item.aspectRatio).toBe('16:9');
  });

  it('sin formatos viables devuelve vacío', () => {
    const items = buildPlan(
      plannerInput({ available: { product: false, packaging: false } }),
    );
    expect(items).toHaveLength(0);
  });

  it('sin pool de personajes y formato con personaje agrega el presentador genérico al scenePrompt', () => {
    const items = buildPlan(
      plannerInput({ characters: [] }),
    );
    const vozcercana = items.filter((i) => i.formatSlug === 'voz-cercana');
    expect(vozcercana.length).toBeGreaterThan(0);
    for (const item of vozcercana) {
      expect(item.characterIds).toEqual([]);
      expect(item.scenePrompt).toContain(DEFAULT_PRESENTER);
    }
  });
});

// ============ Plan dirigido por ideas ============

describe('buildDirectedPlan', () => {
  it('genera exactamente los creativos pedidos, sin rellenar', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [
          { format: fmt('el-icono'), count: 1, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null },
          { format: fmt('susurro'), count: 3, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null },
        ],
      }),
    );
    expect(items).toHaveLength(4);
    const bySlug = new Map<string, number>();
    for (const i of items) bySlug.set(i.formatSlug, (bySlug.get(i.formatSlug) ?? 0) + 1);
    expect(bySlug.get('el-icono')).toBe(1);
    expect(bySlug.get('susurro')).toBe(3);
  });

  it('el scenePrompt del matcher manda sobre las semillas del formato', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [
          {
            format: fmt('mundo-imposible'),
            count: 1,
            durationS: null,
            scenePrompt: 'A dog carries the product through a park, tail wagging',
            sceneSummary: null,
            characterIds: [],
            invented: [],
            scenes: [],
            sequenceLabel: null,
          },
        ],
      }),
    );
    expect(items[0].scenePrompt).toBe('A dog carries the product through a park, tail wagging');
  });

  it('no impone fragmento de scene_library cuando el usuario dio su propia acción (#C)', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [
          {
            format: fmt('mundo-imposible'), count: 1, durationS: null,
            scenePrompt: 'A dog carries the product through a park', sceneSummary: null,
            characterIds: [], invented: [], scenes: [], sequenceLabel: null,
          },
          {
            format: fmt('el-icono'), count: 1, durationS: null,
            scenePrompt: null, sceneSummary: null,
            characterIds: [], invented: [], scenes: [], sequenceLabel: null,
          },
        ],
      }),
    );
    const directed = items.find((i) => i.formatSlug === 'mundo-imposible');
    const seeded = items.find((i) => i.formatSlug === 'el-icono');
    // Acción del usuario → sin fragmento impuesto (evita dos entornos en conflicto).
    expect(directed?.scene).toBe('');
    // Semilla → conserva el fragmento de scene_library.
    expect(seeded?.scene).not.toBe('');
  });

  it('las escenas de una secuencia no heredan fragmento de scene_library (autocontenido)', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [
          {
            format: fmt('gran-pantalla'),
            count: 1,
            durationS: null,
            scenePrompt: null,
            sceneSummary: null,
            characterIds: [],
            invented: [],
            scenes: [
              { scenePrompt: 'A wall ignites and the artwork appears on it', durationS: 5, sceneSummary: null, beatRole: 'beat' as const, characterStateHint: null },
              { scenePrompt: 'The artwork hangs above a sofa in a living room', durationS: 4, sceneSummary: null, beatRole: 'beat' as const, characterStateHint: null },
            ],
            sequenceLabel: 'Reveal',
          },
        ],
      }),
    );
    expect(items).toHaveLength(2);
    // sin fragmento impuesto: el setting vive en el scenePrompt autocontenido
    expect(items.every((i) => i.scene === '')).toBe(true);
    // siguen siendo una secuencia (mismo sequenceId, en orden)
    expect(items[0].sequenceId).not.toBeNull();
    expect(items[1].sequenceId).toBe(items[0].sequenceId);
    expect(items.map((i) => i.sceneIndex)).toEqual([0, 1]);
  });

  it('clampa la duración de la escena a 8s aunque venga del default del formato (custom 15s)', () => {
    // Formato custom con default 15s (pensado para clip único); al partirse en
    // secuencia, cada escena es un beat ≤8s aunque la escena no traiga durationS.
    const customFmt: PlannerFormat = {
      id: 'id-renace', slug: 'renace-tu-pared', name: 'Renace tu pared',
      requiredRefs: ['product'], defaultDurationS: 15, defaultAudio: true,
    };
    const items = buildDirectedPlan(
      directedInput({
        ideas: [
          {
            format: customFmt, count: 1, durationS: null, scenePrompt: null, sceneSummary: null,
            characterIds: [], invented: [],
            scenes: [
              { scenePrompt: 'A wall ignites and the artwork appears', durationS: 5, sceneSummary: null, beatRole: 'beat' as const, characterStateHint: null },
              { scenePrompt: 'The logo glows over the illuminated artwork', durationS: null, sceneSummary: null, beatRole: 'beat' as const, characterStateHint: null },
            ],
            sequenceLabel: 'Renace tu pared',
          },
        ],
      }),
    );
    expect(items).toHaveLength(2);
    expect(items[0].durationS).toBe(5); // explícita, intacta
    expect(items[1].durationS).toBe(8); // null → default 15 → clampada a 8 (beat-role max)
  });

  it('sin scenePrompt usa las semillas del formato', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [{ format: fmt('el-icono'), count: 2, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null }],
      }),
    );
    for (const item of items) {
      expect(item.scenePrompt.length).toBeGreaterThan(20);
      expect(item.scenePrompt).toContain('Lumen Sparkling Water');
    }
    // semillas distintas por variación
    expect(items[0].scenePrompt).not.toBe(items[1].scenePrompt);
  });

  it('filtra ideas cuyos formatos requieren referencias de producto/packaging que faltan', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [
          { format: fmt('el-descubrimiento'), count: 2, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null },
          { format: fmt('el-icono'), count: 1, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null },
        ],
        available: { product: true, packaging: false },
        characters: [],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].formatSlug).toBe('el-icono');
  });

  it('devuelve vacío si ninguna idea es viable', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [{ format: fmt('el-descubrimiento'), count: 1, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null }],
        available: { product: true, packaging: false },
      }),
    );
    expect(items).toHaveLength(0);
  });

  it('aplica el techo demo de 30 creativos en total', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [
          { format: fmt('el-icono'), count: 10, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null },
          { format: fmt('susurro'), count: 10, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null },
          { format: fmt('gran-pantalla'), count: 10, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null },
          { format: fmt('antes-y-despues'), count: 10, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null },
        ],
      }),
    );
    expect(items).toHaveLength(MAX_PLAN_ITEMS);
  });

  it('asigna personajes, aspect ratio y fechas como el plan por mix', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [
          { format: fmt('voz-cercana'), count: 2, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null },
          { format: fmt('gran-pantalla'), count: 1, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null },
        ],
      }),
    );
    for (const item of items) {
      if (item.formatSlug === 'voz-cercana') {
        expect(item.characterIds.length).toBeGreaterThan(0);
      } else {
        expect(item.characterIds).toEqual([]);
      }
      // El formato de video lo decide la campaña (034), uniforme.
      expect(item.aspectRatio).toBe('9:16');
      expect(item.scheduledDate >= '2026-07-01').toBe(true);
      expect(item.scheduledDate <= '2026-07-30').toBe(true);
    }
  });

  // ---- Tests nuevos (Task 3) ----

  it('asigna los personajes mencionados por el matcher al creativo', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [{
          format: fmt('voz-cercana', ['product', 'character']),
          count: 1, durationS: null, scenePrompt: 'She presents the can', sceneSummary: null,
          characterIds: ['c2', 'c1'], invented: [], scenes: [], sequenceLabel: null,
        }],
        characters: [{ id: 'c1', name: 'María' }, { id: 'c2', name: 'Juan' }],
      }),
    );
    expect(items[0].characterIds).toEqual(['c2', 'c1']);
  });

  it('sube la duración de una escena de secuencia cuando el diálogo no cabe (PD-12, speech-fit)', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [{
          format: fmt('el-icono'), // solo product: sin presentador inyectado
          count: 1, durationS: null, scenePrompt: null, sceneSummary: null,
          characterIds: [], invented: [],
          scenes: [{
            // 15 palabras / 2.5 wps ≈ 6s necesarios en un clip de 4s → debe subir (clamp 8).
            scenePrompt: 'medium shot — she speaks to camera. Dialogue: "Esto cambió por completo todas y cada una de mis mañanas desde el primer día."',
            durationS: 4, sceneSummary: null, beatRole: 'beat' as const, characterStateHint: null,
          }],
          sequenceLabel: 'X',
        }],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].durationS).toBeGreaterThan(4);
    expect(items[0].durationS).toBeLessThanOrEqual(8);
  });

  it('sin mención rota un personaje del pool', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [{
          format: fmt('voz-cercana', ['product', 'character']),
          count: 2, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null,
        }],
        characters: [{ id: 'c1', name: 'María' }, { id: 'c2', name: 'Juan' }],
      }),
    );
    expect(items.map((i) => i.characterIds.length)).toEqual([1, 1]);
    expect(items[0].characterIds).not.toEqual(items[1].characterIds);
  });

  it('inventados van al scene_prompt y el formato con personaje ya no se bloquea sin pool', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [{
          format: fmt('voz-cercana', ['product', 'character']),
          count: 1, durationS: null, scenePrompt: 'Lucia tries the product', sceneSummary: null,
          characterIds: [],
          invented: [{ name: 'Lucía', description: 'a presenter with short auburn hair' }],
          scenes: [], sequenceLabel: null,
        }],
        characters: [],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].characterIds).toEqual([]);
    expect(items[0].scenePrompt).toContain('Lucía is a presenter with short auburn hair');
  });

  it('formato con personaje, sin pool y sin inventados usa el presentador genérico', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [{
          format: fmt('voz-cercana', ['product', 'character']),
          count: 1, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null,
        }],
        characters: [],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].scenePrompt).toContain(DEFAULT_PRESENTER);
  });

  it('la duración del matcher manda sobre la default del formato', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [
          { format: fmt('el-icono'), count: 1, durationS: 12, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null },
          { format: fmt('el-icono'), count: 1, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null },
        ],
      }),
    );
    const durations = items.map((i) => i.durationS).sort((a, b) => a - b);
    expect(durations).toEqual([8, 12]); // null cae al default del formato (8)
  });

  it('sceneSummary del matcher manda; con semilla cae al resumen en español; en inglés es null', () => {
    // Resumen del matcher: se respeta tal cual.
    const withSummary = buildDirectedPlan(
      directedInput({
        ideas: [{
          format: fmt('el-icono'), count: 1, durationS: null,
          scenePrompt: 'The can spins on marble', sceneSummary: 'La lata gira sobre mármol',
          characterIds: [], invented: [], scenes: [], sequenceLabel: null,
        }],
      }),
    );
    expect(withSummary[0].sceneSummary).toBe('La lata gira sobre mármol');

    // Sin scenePrompt del matcher (semilla) y campaña en español: resumen ES.
    const seeded = buildDirectedPlan(
      directedInput({
        ideas: [{ format: fmt('el-icono'), count: 1, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null }],
      }),
    );
    expect(seeded[0].sceneSummary).toMatch(/producto/);

    // Campaña en inglés: sin resumen — la UI muestra el scenePrompt.
    const english = buildDirectedPlan(
      directedInput({
        ideas: [{ format: fmt('el-icono'), count: 1, durationS: null, scenePrompt: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null }],
        language: 'en',
      }),
    );
    expect(english[0].sceneSummary).toBeNull();
  });

  it('characterIds con ids inexistentes en el pool cae a rotación del pool', () => {
    // El matcher devolvió un id que ya no existe en la campaña ('c-borrado').
    // El planner debe ignorarlo y asignar por rotación del pool real.
    const items = buildDirectedPlan(
      directedInput({
        ideas: [{
          format: fmt('voz-cercana', ['product', 'character']),
          count: 2,
          durationS: null,
          scenePrompt: null,
          sceneSummary: null,
          characterIds: ['c-borrado'],
          invented: [],
          scenes: [],
          sequenceLabel: null,
        }],
        characters: [{ id: 'c-pool-1', name: 'Ana' }, { id: 'c-pool-2', name: 'Bruno' }],
      }),
    );
    expect(items).toHaveLength(2);
    // Cada item debe llevar exactamente 1 personaje del pool real
    expect(items[0].characterIds).toHaveLength(1);
    expect(items[1].characterIds).toHaveLength(1);
    const validIds = new Set(['c-pool-1', 'c-pool-2']);
    expect(validIds.has(items[0].characterIds[0])).toBe(true);
    expect(validIds.has(items[1].characterIds[0])).toBe(true);
  });

  it('una idea-secuencia produce N items con mismo sequenceId, sceneIndex 0..N-1 y misma fecha', () => {
    const format = { id: 'f1', slug: 'gran-pantalla', name: 'Gran Pantalla', requiredRefs: ['product'], defaultDurationS: 8, defaultAudio: true };
    const items = buildDirectedPlan({
      ideas: [{
        format, count: 1, scenePrompt: null, durationS: null, sceneSummary: null,
        characterIds: [], invented: [],
        scenes: [
          { scenePrompt: 'Scene one with the product', durationS: 4, sceneSummary: 'uno', beatRole: 'beat' as const, characterStateHint: null },
          { scenePrompt: 'Scene two with the product', durationS: 6, sceneSummary: 'dos', beatRole: 'beat' as const, characterStateHint: null },
          { scenePrompt: 'Scene three with the product', durationS: 5, sceneSummary: 'tres', beatRole: 'beat' as const, characterStateHint: null },
        ],
        sequenceLabel: 'Mi anuncio',
      }],
      productName: 'Producto', goal: 'mixed', scenes: [], characters: [],
      available: { product: true, packaging: true },
      dateStart: new Date('2026-07-01'), dateEnd: new Date('2026-07-30'),
      draftModelSlug: 'bytedance/seedance-2.0/fast/text-to-video',
      language: 'es', aspectRatio: '9:16',
    });
    expect(items).toHaveLength(3);
    const seqIds = new Set(items.map((i) => i.sequenceId));
    expect(seqIds.size).toBe(1);
    expect([...seqIds][0]).not.toBeNull();
    expect(items.map((i) => i.sceneIndex)).toEqual([0, 1, 2]);
    expect(items.map((i) => i.sequenceLabel)).toEqual(['Mi anuncio', 'Mi anuncio', 'Mi anuncio']);
    expect(new Set(items.map((i) => i.scheduledDate)).size).toBe(1);
    expect(items.map((i) => i.durationS)).toEqual([4, 6, 5]);
    expect(items.map((i) => i.scenePrompt)).toEqual([
      'Scene one with the product', 'Scene two with the product', 'Scene three with the product',
    ]);
  });

  it('una idea normal (sin scenes) sigue siendo un item con sequenceId null', () => {
    const format = { id: 'f2', slug: 'voz-cercana', name: 'Voz Cercana', requiredRefs: ['product'], defaultDurationS: 9, defaultAudio: true };
    const items = buildDirectedPlan({
      ideas: [{ format, count: 1, scenePrompt: 'She lifts the product to camera', durationS: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null }],
      productName: 'Producto', goal: 'mixed', scenes: [], characters: [],
      available: { product: true, packaging: true },
      dateStart: new Date('2026-07-01'), dateEnd: new Date('2026-07-30'),
      draftModelSlug: 'bytedance/seedance-2.0/fast/text-to-video',
      language: 'es', aspectRatio: '9:16',
    });
    expect(items).toHaveLength(1);
    expect(items[0].sequenceId).toBeNull();
    expect(items[0].sceneIndex).toBeNull();
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

it('MergeSequenceSchema exige uuids de secuencia y campaña', () => {
  expect(MergeSequenceSchema.safeParse({ sequenceId: 'no-uuid', campaignId: 'x' }).success).toBe(false);
  const ok = MergeSequenceSchema.safeParse({
    sequenceId: '00000000-0000-4000-8000-000000000001',
    campaignId: '00000000-0000-4000-8000-000000000002',
  });
  expect(ok.success).toBe(true);
});

it('mergeScenes une por saltos de linea y capa la duracion a 15', () => {
  const { joinedPrompt, mergedDuration } = mergeScenes([
    { scene_prompt: 'A', duration_s: 6 },
    { scene_prompt: 'B', duration_s: 6 },
    { scene_prompt: 'C', duration_s: 6 },
  ]);
  expect(joinedPrompt).toBe('A\nB\nC');
  expect(mergedDuration).toBe(15);
});
