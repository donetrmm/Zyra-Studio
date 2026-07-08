// lib/campaigns/ingest-transport.test.ts
// Test del transporte de ingestMasterPrompt (gatewayText), separado de
// ingest.test.ts: ese archivo importa './ingest' estáticamente para las
// funciones puras (parseIngestResult, mergeVisualDetails, ...), y un
// vi.mock('@/lib/providers/gateway') de módulo en ese mismo archivo choca con
// el hoisting de vitest (el import estático de './ingest' se hoistea junto
// con el mock, antes de que gatewayTextMock exista → ReferenceError). Aislar
// el mock aquí, con import dinámico como en lib/refine/gemini.test.ts y
// lib/creation/clarify.test.ts, evita el problema sin tocar los tests puros.
import { afterEach, describe, expect, it, vi } from 'vitest';

const gatewayTextMock = vi.fn();
vi.mock('@/lib/providers/gateway', () => ({
  gatewayText: gatewayTextMock,
}));

const { ingestMasterPrompt } = await import('./ingest');

afterEach(() => {
  gatewayTextMock.mockReset();
});

describe('ingestMasterPrompt (transporte)', () => {
  it('llama a gatewayText con los caps de memoria (maxOutputTokens 32768, temperature 0.2, label ingest)', async () => {
    gatewayTextMock.mockResolvedValue({
      text: JSON.stringify({ narrative: 'Clip 1: ella levanta el producto.' }),
      finishReason: 'stop',
    });
    const res = await ingestMasterPrompt({ masterPrompt: 'Mi prompt maestro', castNames: [] });
    expect(res.narrative).toBe('Clip 1: ella levanta el producto.');
    // Regresión: el cap de maxOutputTokens (32768) protege contra el JSON
    // truncado que caía en fallback silencioso cuando el guion se acercaba
    // al límite de MASTER_PROMPT_MAX (documentado: caso Anuncio #12).
    expect(gatewayTextMock.mock.calls[0][0].maxOutputTokens).toBe(32768);
    expect(gatewayTextMock.mock.calls[0][0].temperature).toBe(0.2);
    expect(gatewayTextMock.mock.calls[0][0].label).toBe('ingest');
  });
});
