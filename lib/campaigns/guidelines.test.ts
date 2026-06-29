import { describe, it, expect } from 'vitest';
import { CreativeGuidelinesSchema, creativeGuidelineClauses } from './guidelines';

describe('CreativeGuidelinesSchema', () => {
  it('acepta flags válidos y tolera ausencia (todo apagado)', () => {
    expect(CreativeGuidelinesSchema.parse({}).showFullProduct).toBeUndefined();
    expect(CreativeGuidelinesSchema.parse({ showFullProduct: true, safeCrop: '4:5' }).safeCrop).toBe('4:5');
    expect(CreativeGuidelinesSchema.parse({ safeCrop: null }).safeCrop).toBeNull();
  });
  it('rechaza safeCrop inválido', () => {
    expect(CreativeGuidelinesSchema.safeParse({ safeCrop: '16:9' }).success).toBe(false);
  });
});

describe('creativeGuidelineClauses', () => {
  it('sin guías o vacío: cadena vacía', () => {
    expect(creativeGuidelineClauses(undefined)).toBe('');
    expect(creativeGuidelineClauses({})).toBe('');
  });
  it('showFullProduct emite su cláusula', () => {
    const out = creativeGuidelineClauses({ showFullProduct: true });
    expect(out).toContain('frame it complete and unobstructed');
    expect(out.startsWith(' ')).toBe(true);
  });
  it('hookProductHero solo dispara en el beat de apertura', () => {
    expect(creativeGuidelineClauses({ hookProductHero: true }, { isOpeningBeat: false })).toBe('');
    expect(creativeGuidelineClauses({ hookProductHero: true }, { isOpeningBeat: true })).toContain('opening hook');
  });
  it('safeCrop 4:5 emite la cláusula de encuadre seguro', () => {
    expect(creativeGuidelineClauses({ safeCrop: '4:5' })).toContain('central 4:5 area');
  });
  it('es ASCII puro', () => {
    const out = creativeGuidelineClauses({ showFullProduct: true, hookProductHero: true, safeCrop: '4:5' }, { isOpeningBeat: true });
    expect(/^[\x00-\x7F]*$/.test(out)).toBe(true);
  });
});
