import { describe, it, expect } from 'vitest';
import { directorContextFor, resolveLocations, type CampaignContext } from './orchestrator';

// Supabase falso: despacha por tabla. Cubre las dos queries de resolveLocations
// (locations + media_references vía resolvePaths). Sin red.
function fakeSupabase(byTable: Record<string, unknown[]>) {
  return {
    from: (table: string) => ({
      select: () => ({ in: async () => ({ data: byTable[table] ?? [] }) }),
    }),
  } as unknown as Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;
}

describe('resolveLocations — mapa de escala (P15)', () => {
  it('resuelve scale_map_image_id a un path y adjunta las notas', async () => {
    const sb = fakeSupabase({
      locations: [{
        id: 'loc1', workspace_id: 'ws', name: 'Calle', description: 'd',
        master_image_id: 'm1', scale_map_image_id: 'sm1', scale_map_notes: 'mascota 2x',
      }],
      media_references: [
        { id: 'm1', storage_url: 'ws/master.png', workspace_id: 'ws' },
        { id: 'sm1', storage_url: 'ws/map.png', workspace_id: 'ws' },
      ],
    });
    const map = await resolveLocations(sb, 'ws', ['loc1']);
    expect(map.get('loc1')?.imagePaths).toEqual(['ws/master.png']);
    expect(map.get('loc1')?.scaleMap).toEqual({ path: 'ws/map.png', notes: 'mascota 2x' });
  });

  it('sin scale_map_image_id, scaleMap queda undefined', async () => {
    const sb = fakeSupabase({
      locations: [{ id: 'loc1', workspace_id: 'ws', name: 'Calle', description: null, master_image_id: null, scale_map_image_id: null, scale_map_notes: null }],
      media_references: [],
    });
    const map = await resolveLocations(sb, 'ws', ['loc1']);
    expect(map.get('loc1')?.scaleMap).toBeUndefined();
  });
});

describe('directorContextFor — propaga scaleMap (P15)', () => {
  const baseItem = { id: 'i1', scene: null, character_id: null, character_ids: null } as unknown as Parameters<typeof directorContextFor>[0];
  const ctx: CampaignContext = {
    productName: 'Serum', productImagePaths: ['ws/p.png'], packagingImagePaths: [],
    characters: new Map(), language: 'es',
  };
  it('lleva el scaleMap de la locación al DirectorContext', () => {
    const loc = { name: 'Calle', description: 'd', imagePaths: ['ws/street.png'], scaleMap: { path: 'ws/map.png', notes: 'n' } };
    const dc = directorContextFor(baseItem, null, ctx, undefined, undefined, loc);
    expect(dc.location?.scaleMap).toEqual({ path: 'ws/map.png', notes: 'n' });
  });
});

// ItemRow mínimo: directorContextFor solo lee scene, character ids y formato.
const item = {
  id: 'i1',
  scene: null,
  character_id: null,
  character_ids: null,
} as unknown as Parameters<typeof directorContextFor>[0];

function ctxWith(audioRefPath?: string): CampaignContext {
  return {
    productName: 'Serum',
    productImagePaths: ['ws/p.png'],
    packagingImagePaths: [],
    characters: new Map(),
    language: 'es',
    ...(audioRefPath ? { audioRefPath } : {}),
  };
}

describe('directorContextFor — audioRefPath (P16)', () => {
  it('propaga audioRefPath del CampaignContext al DirectorContext', () => {
    const dc = directorContextFor(item, null, ctxWith('ws/u/beat.mp3'));
    expect(dc.audioRefPath).toBe('ws/u/beat.mp3');
  });
  it('sin pista, audioRefPath queda undefined', () => {
    const dc = directorContextFor(item, null, ctxWith());
    expect(dc.audioRefPath).toBeUndefined();
  });
});

describe('directorContextFor — productImageUsages (AM)', () => {
  it('propaga productImageUsages al imageUsages del producto (AM)', () => {
    const ctx: CampaignContext = {
      productName: 'Serum',
      productImagePaths: ['ws/a.png', 'ws/b.png'],
      productImageUsages: { 'ws/b.png': 'three-quarter view' },
      packagingImagePaths: [],
      characters: new Map(),
      language: 'es',
    };
    const dc = directorContextFor(item, null, ctx);
    expect(dc.product?.imageUsages).toEqual({ 'ws/b.png': 'three-quarter view' });
  });
});

describe('directorContextFor — dimensiones del producto', () => {
  it('propaga las dimensiones del producto a DirectorContext.product', () => {
    const ctx: CampaignContext = {
      productName: 'Canvas',
      productImagePaths: [],
      packagingImagePaths: [],
      characters: new Map(),
      language: 'es',
      productHeightCm: 150,
      productWidthCm: 100,
    };
    const res = directorContextFor(item, null, ctx);
    expect(res.product?.heightCm).toBe(150);
    expect(res.product?.widthCm).toBe(100);
  });
});

describe('directorContextFor — character_state_hint (P05)', () => {
  it('sustituye el master por la variante de estado y setea stateLabel (P05)', () => {
    const ctx: CampaignContext = {
      productName: 'Serum', productImagePaths: [], packagingImagePaths: [],
      characters: new Map([['c1', {
        name: 'Marcela', description: 'x', masterImagePath: 'ws/master.png',
        angleImagePaths: [], states: { sudado: 'ws/sweaty.png' },
      }]]),
      language: 'es',
    };
    const sweaty = { id: 'i1', character_ids: ['c1'], character_id: null, scene: null, character_state_hint: 'sudado' } as unknown as Parameters<typeof directorContextFor>[0];
    const dc = directorContextFor(sweaty, null, ctx);
    expect(dc.characters?.[0].masterImagePath).toBe('ws/sweaty.png');
    expect(dc.characters?.[0].stateLabel).toBe('sudado');

    const neutral = { id: 'i2', character_ids: ['c1'], character_id: null, scene: null, character_state_hint: null } as unknown as Parameters<typeof directorContextFor>[0];
    const dc2 = directorContextFor(neutral, null, ctx);
    expect(dc2.characters?.[0].masterImagePath).toBe('ws/master.png');
    expect(dc2.characters?.[0].stateLabel).toBeUndefined();
  });
});

describe('directorContextFor — creative guidelines', () => {
  it('directorContextFor propaga las guias creativas de la campana', () => {
    const ctx = { ...ctxWith(), guidelines: { showFullProduct: true, safeCrop: '4:5' as const } };
    const dir = directorContextFor(item, null, ctx);
    expect(dir.guidelines?.showFullProduct).toBe(true);
    expect(dir.guidelines?.safeCrop).toBe('4:5');
  });
});

describe('directorContextFor — medium y thicknessMm del producto', () => {
  it('directorContextFor propaga medium y thicknessMm del producto', () => {
    const ctx = { ...ctxWith(), productMedium: 'canvas print', productThicknessMm: 10 };
    const dir = directorContextFor(item, null, ctx);
    expect(dir.product?.medium).toBe('canvas print');
    expect(dir.product?.thicknessMm).toBe(10);
  });
});

describe('directorContextFor — peso del producto', () => {
  it('propaga el peso del producto al DirectorContext', () => {
    const dir = directorContextFor(item, null, { ...ctxWith(), productWeightKg: 25 });
    expect(dir.product?.weightKg).toBe(25);
    expect(directorContextFor(item, null, ctxWith()).product?.weightKg).toBeUndefined();
  });
});

describe('directorContextFor — perfil de estilo visual (051)', () => {
  it('propaga el perfil de estilo de la campaña al DirectorContext', () => {
    const dir = directorContextFor(item, null, {
      ...ctxWith(),
      visualStyle: 'animado',
    });
    expect(dir.style).toEqual({ slug: 'animado' });

    const dirCustom = directorContextFor(item, null, {
      ...ctxWith(),
      visualStyle: 'custom',
      visualStyleCustom: 'acuarela suave',
    });
    expect(dirCustom.style).toEqual({ slug: 'custom', custom: 'acuarela suave' });

    // Campañas viejas sin columna: sin style (los helpers caen a ultra_realista).
    expect(directorContextFor(item, null, ctxWith()).style).toBeUndefined();
  });
});
