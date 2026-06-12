// lib/prompt-director/format-matcher.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchIdeas, type MatcherFormat } from './format-matcher';

const FORMATS: MatcherFormat[] = [
  { id: 'f1', slug: 'el-descubrimiento', name: 'El Descubrimiento', description: 'Unboxing / revelación' },
  { id: 'f2', slug: 'voz-cercana', name: 'Voz Cercana', description: 'Testimonio de creador' },
];

function geminiOk(payload: unknown) {
  return {
    ok: true, status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('matchIdeas', () => {
  it('mapea una idea a un formato existente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'un unboxing del producto', formatId: 'f1', customFormat: null }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'un unboxing del producto', formats: FORMATS });
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0].formatId).toBe('f1');
    expect(res.matches[0].customFormat).toBeNull();
  });

  it('propone formato custom cuando no encaja', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'mi perro usa el producto',
        formatId: null,
        customFormat: {
          slug: 'mascota-protagonista', name: 'Mascota protagonista',
          description: 'El producto en la vida de una mascota',
          register: 'casero y tierno', cameraStyle: 'handheld a ras de suelo',
          pacing: 'pausado', requiredRefs: ['product'],
          defaultDurationS: 8, defaultAudio: true,
        },
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'mi perro usa el producto', formats: FORMATS });
    expect(res.matches[0].formatId).toBeNull();
    expect(res.matches[0].customFormat?.slug).toBe('mascota-protagonista');
  });

  it('rechaza la respuesta si ningún match es válido (con reintento)', async () => {
    const fetchMock = vi.fn(async () => geminiOk({ matches: [{ bogus: true }] }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.GEMINI_API_KEY = 'test';
    await expect(
      matchIdeas({ ideasText: 'algo', formats: FORMATS, retryDelayMs: 0 }),
    ).rejects.toThrow(/matches válidos/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('normaliza customFormat con claves en español y campos faltantes (caso real de Vercel)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'una escena majestuosa como de deidad del refresco',
        formatId: null,
        customFormat: {
          slug: 'deidad-del-refresco',
          registro: 'Fantástico, épico',
          estiloDeCamara: 'Cinemático, gran angular',
          ritmo: 'Lento, majestuoso',
        },
        count: 1,
        scenePrompt: 'A majestic deity-like scene of the soft drink appears',
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'deidad del refresco', formats: FORMATS });
    const cf = res.matches[0].customFormat;
    expect(cf).not.toBeNull();
    expect(cf?.slug).toBe('deidad-del-refresco');
    expect(cf?.name).toBe('Deidad del refresco');
    expect(cf?.register).toBe('Fantástico, épico');
    expect(cf?.cameraStyle).toBe('Cinemático, gran angular');
    expect(cf?.pacing).toBe('Lento, majestuoso');
    expect(cf?.requiredRefs).toEqual(['product']);
    expect(cf?.defaultDurationS).toBe(8);
    expect(cf?.defaultAudio).toBe(true);
  });

  it('normaliza slug con acentos y clampa la duración', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'algo épico',
        formatId: null,
        customFormat: { name: 'Visión Épica', defaultDurationS: 30 },
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'algo épico', formats: FORMATS });
    const cf = res.matches[0].customFormat;
    expect(cf?.slug).toBe('vision-epica');
    expect(cf?.name).toBe('Visión Épica');
    expect(cf?.defaultDurationS).toBe(15);
  });

  it('customFormat null se conserva como null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'un unboxing', formatId: 'f1', customFormat: null }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS });
    expect(res.matches[0].customFormat).toBeNull();
  });

  it('descarta el match malformado pero conserva los válidos', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [
        { bogus: true },
        { ideaText: 'un unboxing', formatId: 'f1', customFormat: null },
      ],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS });
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0].formatId).toBe('f1');
  });

  it('tolera JSON envuelto en fences markdown', async () => {
    const payload = JSON.stringify({
      matches: [{ ideaText: 'un unboxing', formatId: 'f1', customFormat: null }],
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '```json\n' + payload + '\n```' }] } }],
      }),
    }) as Response));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS });
    expect(res.matches[0].formatId).toBe('f1');
  });

  it('reintenta una vez ante rate limit y falla si persiste', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 429 }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    process.env.GEMINI_API_KEY = 'test';
    await expect(
      matchIdeas({ ideasText: 'algo', formats: FORMATS, retryDelayMs: 0 }),
    ).rejects.toMatchObject({ code: 'rate_limit', retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('se recupera si el reintento tras 429 responde bien', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 } as Response)
      .mockResolvedValueOnce(geminiOk({
        matches: [{ ideaText: 'un unboxing', formatId: 'f1', customFormat: null }],
      }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS, retryDelayMs: 0 });
    expect(res.matches[0].formatId).toBe('f1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('no reintenta errores no recuperables (auth)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 403 }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    process.env.GEMINI_API_KEY = 'test';
    await expect(
      matchIdeas({ ideasText: 'algo', formats: FORMATS, retryDelayMs: 0 }),
    ).rejects.toMatchObject({ code: 'auth' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sin count ni scenePrompt aplica defaults (1 y null)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'un unboxing', formatId: 'f1', customFormat: null }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS });
    expect(res.matches[0].count).toBe(1);
    expect(res.matches[0].scenePrompt).toBeNull();
  });

  it('conserva count y scenePrompt cuando la idea los trae', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: '3 unboxings donde se ve el sello al abrir',
        formatId: 'f1',
        customFormat: null,
        count: 3,
        scenePrompt: 'Hands break the seal slowly and lift the product into soft light',
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: '3 unboxings...', formats: FORMATS });
    expect(res.matches[0].count).toBe(3);
    expect(res.matches[0].scenePrompt).toContain('seal');
  });

  it('count fuera de rango cae al default sin tirar el match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'muchos unboxings', formatId: 'f1', customFormat: null, count: 99 }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'muchos unboxings', formats: FORMATS });
    expect(res.matches[0].count).toBe(1);
  });

  it('descarta formatId que no existe en la lista', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'x', formatId: 'inventado', customFormat: null }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'x', formats: FORMATS });
    expect(res.matches[0].formatId).toBeNull(); // saneado a custom pendiente o null
  });

  it('devuelve characterIds saneados contra el pool', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'María hace un unboxing', formatId: 'f1', customFormat: null,
        characterIds: ['c1', 'c-falso', 'c2'],
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({
      ideasText: 'María hace un unboxing', formats: FORMATS,
      characters: [{ id: 'c1', name: 'María' }, { id: 'c2', name: 'Juan' }],
    });
    expect(res.matches[0].characterIds).toEqual(['c1', 'c2']);
  });

  it('characterIds vacío y sin crash cuando el modelo no manda el campo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'un unboxing', formatId: 'f1', customFormat: null }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS });
    expect(res.matches[0].characterIds).toEqual([]);
    expect(res.matches[0].inventedCharacters).toEqual([]);
    expect(res.matches[0].sceneSummary).toBeNull();
  });

  it('sceneSummary se parsea y un scenePrompt con timeline largo no se descarta', async () => {
    const timeline =
      '0-3s: wide shot, the can rests on wet stone. 3-7s: dolly in as condensation runs down the label. ' +
      '7-9s: the can is lifted and tilted toward camera, label forward, soft light catching the rim.';
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'un video del producto en piedra mojada', formatId: 'f1', customFormat: null,
        scenePrompt: timeline, sceneSummary: 'La lata sobre piedra mojada, revelada con un dolly in',
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'un video del producto en piedra mojada', formats: FORMATS });
    expect(res.matches[0].scenePrompt).toBe(timeline);
    expect(res.matches[0].sceneSummary).toBe('La lata sobre piedra mojada, revelada con un dolly in');
  });

  it('characterIds dedupe y recorta a 3', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'todos presentan', formatId: 'f1', customFormat: null,
        characterIds: ['c1', 'c1', 'c2', 'c3', 'c4'],
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({
      ideasText: 'todos presentan', formats: FORMATS,
      characters: [
        { id: 'c1', name: 'A' }, { id: 'c2', name: 'B' },
        { id: 'c3', name: 'C' }, { id: 'c4', name: 'D' },
      ],
    });
    expect(res.matches[0].characterIds).toEqual(['c1', 'c2', 'c3']);
  });

  it('inventedCharacters se parsea y los malformados se descartan sin tirar el match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'Lucía presenta', formatId: 'f2', customFormat: null,
        inventedCharacters: [
          { name: 'Lucía', description: 'a presenter with short auburn hair and a denim jacket' },
          { bogus: true },
        ],
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'Lucía presenta', formats: FORMATS, characters: [] });
    expect(res.matches[0].inventedCharacters).toEqual([
      { name: 'Lucía', description: 'a presenter with short auburn hair and a denim jacket' },
    ]);
  });
});
