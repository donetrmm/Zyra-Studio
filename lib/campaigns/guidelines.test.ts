import { describe, it, expect } from 'vitest';
import { CreativeGuidelinesSchema, creativeGuidelineClauses, guidelinesForSafeBase } from './guidelines';

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

  // Reconciliacion: safeCrop + completar-producto se pelean si se emiten por
  // separado ("grande" llena el 9:16 mientras "central 4:5" lo encoge). Cuando ambos
  // estan activos, UNA sola clausula ata "completo" al safe area y acota "grande".
  it('safeCrop + showFullProduct: clausula reconciliada, no las dos que compiten', () => {
    const out = creativeGuidelineClauses({ showFullProduct: true, safeCrop: '4:5' });
    // Marcador de la clausula reconciliada: "completo" atado al 4:5.
    expect(out).toContain('all four of its edges inside that 4:5 area');
    expect(out).toContain('central 4:5 area');
    // Ya NO emite las dos clausulas separadas que se peleaban.
    expect(out).not.toContain('frame it complete and unobstructed');
    expect(out).not.toContain('Crop-safe framing:');
  });

  it('safeCrop + hookProductHero (apertura): reconciliada + enfasis de hook, sin "large" suelto', () => {
    const out = creativeGuidelineClauses({ hookProductHero: true, safeCrop: '4:5' }, { isOpeningBeat: true });
    expect(out).toContain('opening hook');
    expect(out).toContain('all four of its edges inside that 4:5 area');
    // El "shown large and complete" original empujaba a llenar el 9:16 -> fuera.
    expect(out).not.toContain('shown large and complete');
  });

  it('safeCrop + hookProductHero pero NO apertura: reconcilia por nada (hook off) -> solo safe area', () => {
    const out = creativeGuidelineClauses({ hookProductHero: true, safeCrop: '4:5' }, { isOpeningBeat: false });
    // hook no aplica y no hay showFullProduct -> no reconcilia: cae al safe-crop generico.
    expect(out).toContain('Crop-safe framing:');
    expect(out).not.toContain('opening hook');
  });

  it('showFullProduct SIN safeCrop: comportamiento original (sin reconciliar)', () => {
    const out = creativeGuidelineClauses({ showFullProduct: true });
    expect(out).toContain('frame it complete and unobstructed');
    expect(out).not.toContain('all four of its edges inside that 4:5 area');
  });
});

describe('safeAreaExtend', () => {
  it('el schema acepta safeAreaExtend y tolera ausencia', () => {
    expect(CreativeGuidelinesSchema.parse({ safeAreaExtend: true }).safeAreaExtend).toBe(true);
    expect(CreativeGuidelinesSchema.parse({}).safeAreaExtend).toBeUndefined();
  });
});

describe('guidelinesForSafeBase', () => {
  it('neutraliza safeCrop y safeAreaExtend, conserva product/hook', () => {
    const base = guidelinesForSafeBase({
      showFullProduct: true,
      hookProductHero: true,
      safeCrop: '4:5',
      safeAreaExtend: true,
    });
    expect(base).toEqual({ showFullProduct: true, hookProductHero: true, safeCrop: null, safeAreaExtend: false });
  });

  it('en la base 4:5 ya no emite la clausula de safe-crop, pero si product/hook', () => {
    const base = guidelinesForSafeBase({ showFullProduct: true, hookProductHero: true, safeCrop: '4:5', safeAreaExtend: true });
    const out = creativeGuidelineClauses(base, { isOpeningBeat: true });
    expect(out).toContain('frame it complete and unobstructed');
    expect(out).toContain('opening hook');
    expect(out).not.toContain('central 4:5 area');
    expect(out).not.toContain('all four of its edges inside that 4:5 area');
  });

  it('tolera undefined', () => {
    expect(guidelinesForSafeBase(undefined)).toBeUndefined();
  });
});
