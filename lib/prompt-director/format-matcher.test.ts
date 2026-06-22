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

  it('scenePrompt largo (>1500) se conserva en vez de caer a null', async () => {
    const longTimeline =
      '0-3s: Brenda looks straight into the camera while a giant LED wall behind her scrolls thousands of family photographs. ' +
      'Dialogue: "You are going to lose them if you do nothing with the photos on your phone." '.repeat(18);
    expect(longTimeline.length).toBeGreaterThan(1500);
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'anuncio cuadro familiar', formatId: 'f1', customFormat: null,
        scenePrompt: longTimeline,
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'anuncio cuadro familiar', formats: FORMATS });
    expect(res.matches[0].scenePrompt).not.toBeNull();
    expect(res.matches[0].scenePrompt!.length).toBeGreaterThan(1500);
  });

  it('scenePrompt descomunal se recorta en frontera de palabra, nunca a null', async () => {
    const huge = 'Brenda walks around the floating family photo in a dark museum room. '.repeat(80);
    expect(huge.length).toBeGreaterThan(3000);
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'museo de recuerdos', formatId: 'f1', customFormat: null, scenePrompt: huge }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'museo', formats: FORMATS });
    expect(res.matches[0].scenePrompt).not.toBeNull();
    expect(res.matches[0].scenePrompt!.length).toBeLessThanOrEqual(3000);
    expect(res.matches[0].scenePrompt!.endsWith(' ')).toBe(false);
  });

  it('scenePrompt no string (number) sigue cayendo a null sin tirar el match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'x', formatId: 'f1', customFormat: null, scenePrompt: 12345 }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'x', formats: FORMATS });
    expect(res.matches[0].scenePrompt).toBeNull();
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

  it('las imágenes adjuntas viajan como inline_data con su rol declarado en el texto', async () => {
    const fetchMock = vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'un unboxing', formatId: 'f1', customFormat: null }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.GEMINI_API_KEY = 'test';
    await matchIdeas({
      ideasText: 'un unboxing',
      formats: FORMATS,
      images: [
        { mimeType: 'image/png', dataBase64: 'AAAA', label: 'producto' },
        { mimeType: 'image/jpeg', dataBase64: 'BBBB', label: 'personaje María' },
      ],
    });
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as { body: string };
    const body = JSON.parse(init.body) as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
    };
    const parts = body.contents[0].parts;
    expect(parts).toHaveLength(3);
    expect(String(parts[0].text)).toContain('1=producto, 2=personaje María');
    expect(parts[1]).toEqual({ inline_data: { mime_type: 'image/png', data: 'AAAA' } });
    expect(parts[2]).toEqual({ inline_data: { mime_type: 'image/jpeg', data: 'BBBB' } });
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

  it('parsea una secuencia con scenes[] ordenadas y sequenceLabel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'anuncio cuadro familiar de 15s con 4 actos', formatId: 'f1', customFormat: null,
        sequenceLabel: 'Cuadro familiar',
        scenes: [
          { scenePrompt: '0-3s: Brenda looks at camera, LED wall of photos behind her', durationS: 4, sceneSummary: 'Gancho: Brenda y el muro de fotos' },
          { scenePrompt: 'Brenda walks around a floating family photo in a dark museum room', durationS: 6, sceneSummary: 'Museo de recuerdos' },
          { scenePrompt: 'The family photo becomes a premium framed print in a warm living room', durationS: 5, sceneSummary: 'Revelacion del cuadro' },
        ],
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'anuncio cuadro familiar', formats: FORMATS });
    const m = res.matches[0];
    expect(m.sequenceLabel).toBe('Cuadro familiar');
    expect(m.scenes).toHaveLength(3);
    expect(m.scenes[0].durationS).toBe(4);
    expect(m.scenes[1].scenePrompt).toContain('museum');
  });

  it('clampa la duración de una escena de secuencia a 8s (beat corto), sin tocar las menores', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'anuncio de 4 actos', formatId: 'f1', customFormat: null, sequenceLabel: 'Reveal',
        scenes: [
          { scenePrompt: 'A wall ignites and the artwork appears', durationS: 15 },
          { scenePrompt: 'The camera pans across the artwork details', durationS: 6 },
        ],
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'anuncio', formats: FORMATS });
    expect(res.matches[0].scenes[0].durationS).toBe(8); // 15 → 8
    expect(res.matches[0].scenes[1].durationS).toBe(6); // intacta
  });

  it('quita emojis del scenePrompt (no van dentro del video) y conserva el texto', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'cierre con fuego', formatId: 'f1', customFormat: null,
        scenePrompt: 'The logo glows over the artwork 🔥🔥 and the brand name appears ✨',
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'cierre', formats: FORMATS });
    expect(res.matches[0].scenePrompt).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(res.matches[0].scenePrompt).toContain('The logo glows over the artwork');
    expect(res.matches[0].scenePrompt).toContain('the brand name appears');
  });

  it('quita emojis también en las escenas de una secuencia', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'secuencia con emoji', formatId: 'f1', customFormat: null, sequenceLabel: 'X',
        scenes: [{ scenePrompt: 'Hands open the box 🎁 and lift the product', durationS: 5 }],
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'secuencia', formats: FORMATS });
    expect(res.matches[0].scenes[0].scenePrompt).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(res.matches[0].scenes[0].scenePrompt).toContain('Hands open the box');
  });

  it('descarta una escena malformada sin tirar la secuencia', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'secuencia', formatId: 'f1', customFormat: null, sequenceLabel: 'X',
        scenes: [
          { scenePrompt: 'Scene one is fully valid and concrete', durationS: 5 },
          { durationS: 5 },
          { scenePrompt: 'Scene three is also valid', durationS: 6 },
        ],
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'secuencia', formats: FORMATS });
    expect(res.matches[0].scenes).toHaveLength(2);
    expect(res.matches[0].scenes[1].scenePrompt).toContain('three');
  });

  it('expone el blocker legible cuando el matcher marca una idea no trabajable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'algo padre', formatId: null, customFormat: null,
        blocker: 'la idea no dice qué pasa en pantalla',
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'algo padre', formats: FORMATS });
    expect(res.matches[0].blocker).toBe('la idea no dice qué pasa en pantalla');
  });

  it('blocker ausente o vacío cae a null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [
        { ideaText: 'un unboxing', formatId: 'f1', customFormat: null },
        { ideaText: 'x', formatId: 'f1', customFormat: null, blocker: '   ' },
      ],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'x', formats: FORMATS });
    expect(res.matches[0].blocker).toBeNull();
    expect(res.matches[1].blocker).toBeNull();
  });

  it('idea normal trae scenes vacio (no es secuencia)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'un unboxing', formatId: 'f1', customFormat: null, scenePrompt: 'Hands open the box slowly' }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS });
    expect(res.matches[0].scenes).toEqual([]);
    expect(res.matches[0].sequenceLabel).toBeNull();
  });
});
