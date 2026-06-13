import { describe, it, expect } from 'vitest';
import { ClarifyInputSchema, ClarifyResultSchema } from './creation';

describe('ClarifyInputSchema', () => {
  it('acepta una entrada válida', () => {
    const r = ClarifyInputSchema.safeParse({ text: 'una creadora de cocina', hasReference: false });
    expect(r.success).toBe(true);
  });
  it('rechaza texto vacío', () => {
    expect(ClarifyInputSchema.safeParse({ text: '   ', hasReference: false }).success).toBe(false);
  });
});

describe('ClarifyResultSchema', () => {
  it('saneo laxo: descarta preguntas malformadas y recorta a 3', () => {
    const parsed = ClarifyResultSchema.parse({
      questions: [
        { id: 'a', question: '¿Vestuario?', suggestions: ['casual', 'formal'] },
        { question: 'sin id' },           // malformada → se descarta
        { id: 'b', question: '¿Tono?', suggestions: [] },
        { id: 'c', question: '¿Luz?', suggestions: [] },
        { id: 'd', question: '¿Fondo?', suggestions: [] },
      ],
      enrichedPrompt: 'a kitchen content creator',
    });
    expect(parsed.questions.length).toBe(3);
    expect(parsed.questions[0].id).toBe('a');
    expect(parsed.enrichedPrompt).toBe('a kitchen content creator');
  });
});
