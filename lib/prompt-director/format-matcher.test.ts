// lib/prompt-director/format-matcher.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@/lib/providers/types';
import type { MatcherFormat } from './format-matcher';

const gatewayTextMock = vi.fn();
vi.mock('@/lib/providers/gateway', () => ({
  gatewayText: gatewayTextMock,
}));

const { buildMatcherSystemPrompt, matchIdeas } = await import('./format-matcher');

const FORMATS: MatcherFormat[] = [
  { id: 'f1', slug: 'el-descubrimiento', name: 'El Descubrimiento', description: 'Unboxing / revelación' },
  { id: 'f2', slug: 'voz-cercana', name: 'Voz Cercana', description: 'Testimonio de creador' },
];

function gatewayOk(payload: unknown) {
  return { text: JSON.stringify(payload), finishReason: 'stop' };
}

afterEach(() => {
  vi.unstubAllGlobals();
  gatewayTextMock.mockReset();
});

describe('matchIdeas', () => {
  it('mapea una idea a un formato existente', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{ ideaText: 'un unboxing del producto', formatId: 'f1', customFormat: null }],
    }));
    const res = await matchIdeas({ ideasText: 'un unboxing del producto', formats: FORMATS });
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0].formatId).toBe('f1');
    expect(res.matches[0].customFormat).toBeNull();
    // Regresión: el cap de maxOutputTokens (32768) protege contra el JSON
    // truncado que caía en mix/sin_match cuando el guion se acercaba al límite.
    expect(gatewayTextMock.mock.calls[0][0].maxOutputTokens).toBe(32768);
    expect(gatewayTextMock.mock.calls[0][0].temperature).toBe(0.2);
  });

  it('propone formato custom cuando no encaja', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
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
    }));
    const res = await matchIdeas({ ideasText: 'mi perro usa el producto', formats: FORMATS });
    expect(res.matches[0].formatId).toBeNull();
    expect(res.matches[0].customFormat?.slug).toBe('mascota-protagonista');
  });

  it('rechaza la respuesta si ningún match es válido (con reintento)', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({ matches: [{ bogus: true }] }));
    await expect(
      matchIdeas({ ideasText: 'algo', formats: FORMATS, retryDelayMs: 0 }),
    ).rejects.toThrow(/matches válidos/i);
    expect(gatewayTextMock).toHaveBeenCalledTimes(2);
  });

  it('normaliza customFormat con claves en español y campos faltantes (caso real de Vercel)', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
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
    }));
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
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'algo épico',
        formatId: null,
        customFormat: { name: 'Visión Épica', defaultDurationS: 30 },
      }],
    }));
    const res = await matchIdeas({ ideasText: 'algo épico', formats: FORMATS });
    const cf = res.matches[0].customFormat;
    expect(cf?.slug).toBe('vision-epica');
    expect(cf?.name).toBe('Visión Épica');
    expect(cf?.defaultDurationS).toBe(15);
  });

  it('customFormat null se conserva como null', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{ ideaText: 'un unboxing', formatId: 'f1', customFormat: null }],
    }));
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS });
    expect(res.matches[0].customFormat).toBeNull();
  });

  it('descarta el match malformado pero conserva los válidos', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [
        { bogus: true },
        { ideaText: 'un unboxing', formatId: 'f1', customFormat: null },
      ],
    }));
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS });
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0].formatId).toBe('f1');
  });

  it('tolera JSON envuelto en fences markdown', async () => {
    const payload = JSON.stringify({
      matches: [{ ideaText: 'un unboxing', formatId: 'f1', customFormat: null }],
    });
    gatewayTextMock.mockResolvedValue({ text: '```json\n' + payload + '\n```', finishReason: 'stop' });
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS });
    expect(res.matches[0].formatId).toBe('f1');
  });

  it('reintenta una vez ante rate limit y falla si persiste', async () => {
    gatewayTextMock.mockRejectedValue(new ProviderError('Rate limit Gemini', 'rate_limit', true));
    await expect(
      matchIdeas({ ideasText: 'algo', formats: FORMATS, retryDelayMs: 0 }),
    ).rejects.toMatchObject({ code: 'rate_limit', retryable: true });
    expect(gatewayTextMock).toHaveBeenCalledTimes(2);
  });

  it('se recupera si el reintento tras 429 responde bien', async () => {
    gatewayTextMock
      .mockRejectedValueOnce(new ProviderError('Rate limit Gemini', 'rate_limit', true))
      .mockResolvedValueOnce(gatewayOk({
        matches: [{ ideaText: 'un unboxing', formatId: 'f1', customFormat: null }],
      }));
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS, retryDelayMs: 0 });
    expect(res.matches[0].formatId).toBe('f1');
    expect(gatewayTextMock).toHaveBeenCalledTimes(2);
  });

  it('no reintenta errores no recuperables (auth)', async () => {
    gatewayTextMock.mockRejectedValue(new ProviderError('Auth inválida con AI Gateway', 'auth', false));
    await expect(
      matchIdeas({ ideasText: 'algo', formats: FORMATS, retryDelayMs: 0 }),
    ).rejects.toMatchObject({ code: 'auth' });
    expect(gatewayTextMock).toHaveBeenCalledTimes(1);
  });

  it('sin count ni scenePrompt aplica defaults (1 y null)', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{ ideaText: 'un unboxing', formatId: 'f1', customFormat: null }],
    }));
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS });
    expect(res.matches[0].count).toBe(1);
    expect(res.matches[0].scenePrompt).toBeNull();
  });

  it('conserva count y scenePrompt cuando la idea los trae', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: '3 unboxings donde se ve el sello al abrir',
        formatId: 'f1',
        customFormat: null,
        count: 3,
        scenePrompt: 'Hands break the seal slowly and lift the product into soft light',
      }],
    }));
    const res = await matchIdeas({ ideasText: '3 unboxings...', formats: FORMATS });
    expect(res.matches[0].count).toBe(3);
    expect(res.matches[0].scenePrompt).toContain('seal');
  });

  it('count fuera de rango cae al default sin tirar el match', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{ ideaText: 'muchos unboxings', formatId: 'f1', customFormat: null, count: 99 }],
    }));
    const res = await matchIdeas({ ideasText: 'muchos unboxings', formats: FORMATS });
    expect(res.matches[0].count).toBe(1);
  });

  it('descarta formatId que no existe en la lista', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{ ideaText: 'x', formatId: 'inventado', customFormat: null }],
    }));
    const res = await matchIdeas({ ideasText: 'x', formats: FORMATS });
    expect(res.matches[0].formatId).toBeNull(); // saneado a custom pendiente o null
  });

  it('resuelve formatId cuando el modelo devuelve el slug en vez del id', async () => {
    // El modelo reproduce mal los UUID (sobre todo en ideas multi-escena) y a
    // veces devuelve el slug. Resolver por slug evita el descarte silencioso que
    // dejaba el plan en sin_match.
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{ ideaText: 'una revelación', formatId: 'el-descubrimiento', customFormat: null }],
    }));
    const res = await matchIdeas({ ideasText: 'una revelación', formats: FORMATS });
    expect(res.matches[0].formatId).toBe('f1'); // 'el-descubrimiento' es el slug de f1
  });

  it('devuelve characterIds saneados contra el pool', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'María hace un unboxing', formatId: 'f1', customFormat: null,
        characterIds: ['c1', 'c-falso', 'c2'],
      }],
    }));
    const res = await matchIdeas({
      ideasText: 'María hace un unboxing', formats: FORMATS,
      characters: [{ id: 'c1', name: 'María' }, { id: 'c2', name: 'Juan' }],
    });
    expect(res.matches[0].characterIds).toEqual(['c1', 'c2']);
  });

  it('characterIds vacío y sin crash cuando el modelo no manda el campo', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{ ideaText: 'un unboxing', formatId: 'f1', customFormat: null }],
    }));
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS });
    expect(res.matches[0].characterIds).toEqual([]);
    expect(res.matches[0].inventedCharacters).toEqual([]);
    expect(res.matches[0].sceneSummary).toBeNull();
  });

  it('sceneSummary se parsea y un scenePrompt con timeline largo no se descarta', async () => {
    const timeline =
      '0-3s: wide shot, the can rests on wet stone. 3-7s: dolly in as condensation runs down the label. ' +
      '7-9s: the can is lifted and tilted toward camera, label forward, soft light catching the rim.';
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'un video del producto en piedra mojada', formatId: 'f1', customFormat: null,
        scenePrompt: timeline, sceneSummary: 'La lata sobre piedra mojada, revelada con un dolly in',
      }],
    }));
    const res = await matchIdeas({ ideasText: 'un video del producto en piedra mojada', formats: FORMATS });
    expect(res.matches[0].scenePrompt).toBe(timeline);
    expect(res.matches[0].sceneSummary).toBe('La lata sobre piedra mojada, revelada con un dolly in');
  });

  it('scenePrompt largo (>1500) se conserva en vez de caer a null', async () => {
    const longTimeline =
      '0-3s: Brenda looks straight into the camera while a giant LED wall behind her scrolls thousands of family photographs. ' +
      'Dialogue: "You are going to lose them if you do nothing with the photos on your phone." '.repeat(18);
    expect(longTimeline.length).toBeGreaterThan(1500);
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'anuncio cuadro familiar', formatId: 'f1', customFormat: null,
        scenePrompt: longTimeline,
      }],
    }));
    const res = await matchIdeas({ ideasText: 'anuncio cuadro familiar', formats: FORMATS });
    expect(res.matches[0].scenePrompt).not.toBeNull();
    expect(res.matches[0].scenePrompt!.length).toBeGreaterThan(1500);
  });

  it('scenePrompt descomunal se recorta en frontera de palabra, nunca a null', async () => {
    const huge = 'Brenda walks around the floating family photo in a dark museum room. '.repeat(80);
    expect(huge.length).toBeGreaterThan(3000);
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{ ideaText: 'museo de recuerdos', formatId: 'f1', customFormat: null, scenePrompt: huge }],
    }));
    const res = await matchIdeas({ ideasText: 'museo', formats: FORMATS });
    expect(res.matches[0].scenePrompt).not.toBeNull();
    expect(res.matches[0].scenePrompt!.length).toBeLessThanOrEqual(3000);
    expect(res.matches[0].scenePrompt!.endsWith(' ')).toBe(false);
  });

  it('scenePrompt no string (number) sigue cayendo a null sin tirar el match', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{ ideaText: 'x', formatId: 'f1', customFormat: null, scenePrompt: 12345 }],
    }));
    const res = await matchIdeas({ ideasText: 'x', formats: FORMATS });
    expect(res.matches[0].scenePrompt).toBeNull();
  });

  it('characterIds dedupe y recorta a 3', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'todos presentan', formatId: 'f1', customFormat: null,
        characterIds: ['c1', 'c1', 'c2', 'c3', 'c4'],
      }],
    }));
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
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{ ideaText: 'un unboxing', formatId: 'f1', customFormat: null }],
    }));
    await matchIdeas({
      ideasText: 'un unboxing',
      formats: FORMATS,
      images: [
        { mimeType: 'image/png', dataBase64: 'AAAA', label: 'producto' },
        { mimeType: 'image/jpeg', dataBase64: 'BBBB', label: 'personaje María' },
      ],
    });
    const parts = gatewayTextMock.mock.calls[0][0].contents[0].parts;
    expect(parts).toHaveLength(3);
    expect(String(parts[0].text)).toContain('1=producto, 2=personaje María');
    expect(parts[1]).toEqual({ inline_data: { mime_type: 'image/png', data: 'AAAA' } });
    expect(parts[2]).toEqual({ inline_data: { mime_type: 'image/jpeg', data: 'BBBB' } });
  });

  it('inventedCharacters se parsea y los malformados se descartan sin tirar el match', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'Lucía presenta', formatId: 'f2', customFormat: null,
        inventedCharacters: [
          { name: 'Lucía', description: 'a presenter with short auburn hair and a denim jacket' },
          { bogus: true },
        ],
      }],
    }));
    const res = await matchIdeas({ ideasText: 'Lucía presenta', formats: FORMATS, characters: [] });
    expect(res.matches[0].inventedCharacters).toEqual([
      { name: 'Lucía', description: 'a presenter with short auburn hair and a denim jacket' },
    ]);
  });

  it('parsea una secuencia con scenes[] ordenadas y sequenceLabel', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'anuncio cuadro familiar de 15s con 4 actos', formatId: 'f1', customFormat: null,
        sequenceLabel: 'Cuadro familiar',
        scenes: [
          { scenePrompt: '0-3s: Brenda looks at camera, LED wall of photos behind her', durationS: 4, sceneSummary: 'Gancho: Brenda y el muro de fotos' },
          { scenePrompt: 'Brenda walks around a floating family photo in a dark museum room', durationS: 6, sceneSummary: 'Museo de recuerdos' },
          { scenePrompt: 'The family photo becomes a premium framed print in a warm living room', durationS: 5, sceneSummary: 'Revelacion del cuadro' },
        ],
      }],
    }));
    const res = await matchIdeas({ ideasText: 'anuncio cuadro familiar', formats: FORMATS });
    const m = res.matches[0];
    expect(m.sequenceLabel).toBe('Cuadro familiar');
    expect(m.scenes).toHaveLength(3);
    expect(m.scenes[0].durationS).toBe(4);
    expect(m.scenes[1].scenePrompt).toContain('museum');
  });

  it('clampa la duración de una escena de secuencia a 12s (techo del schema)', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'anuncio de 4 actos', formatId: 'f1', customFormat: null, sequenceLabel: 'Reveal',
        scenes: [
          { scenePrompt: 'A wall ignites and the artwork appears', durationS: 15 },
          { scenePrompt: 'The camera pans across the artwork details', durationS: 6 },
        ],
      }],
    }));
    const res = await matchIdeas({ ideasText: 'anuncio', formats: FORMATS });
    expect(res.matches[0].scenes[0].durationS).toBe(12); // 15 → 12 (techo del schema subio)
    expect(res.matches[0].scenes[1].durationS).toBe(6); // intacta
  });

  it('parsea beatRole reveal/action en las escenas', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'secuencia con reveal', formatId: 'f1', customFormat: null, sequenceLabel: 'X',
        scenes: [
          { scenePrompt: 'she slowly realizes and holds the gaze', durationS: 12, beatRole: 'reveal' },
          { scenePrompt: 'she snaps the cap and turns fast', durationS: 5, beatRole: 'action' },
        ],
      }],
    }));
    const res = await matchIdeas({ ideasText: 'x', formats: FORMATS });
    expect(res.matches[0].scenes[0].beatRole).toBe('reveal');
    expect(res.matches[0].scenes[1].beatRole).toBe('action');
  });

  it('beatRole ausente o inválido cae a beat (catch)', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'secuencia', formatId: 'f1', customFormat: null, sequenceLabel: 'X',
        scenes: [
          { scenePrompt: 'a normal beat happens here', durationS: 6 },
          { scenePrompt: 'another normal beat', durationS: 6, beatRole: 'nonsense' },
        ],
      }],
    }));
    const res = await matchIdeas({ ideasText: 'x', formats: FORMATS });
    expect(res.matches[0].scenes[0].beatRole).toBe('beat');
    expect(res.matches[0].scenes[1].beatRole).toBe('beat');
  });

  it('rebasea/quita marcadores de tiempo acumulativos de las escenas de secuencia (PD-11)', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'secuencia', formatId: 'f1', customFormat: null, sequenceLabel: 'X',
        scenes: [
          { scenePrompt: '0-4s: she enters the room', durationS: 4 },
          { scenePrompt: '4-9s: she lifts the product', durationS: 5 },
          { scenePrompt: '9-13s: she smiles to camera', durationS: 4 },
        ],
      }],
    }));
    const res = await matchIdeas({ ideasText: 'secuencia', formats: FORMATS });
    const prompts = res.matches[0].scenes.map((s) => s.scenePrompt);
    // Beat único por escena → se quita el marcador (cada clip empieza en 0).
    expect(prompts[0]).toBe('she enters the room');
    expect(prompts[1]).toBe('she lifts the product');
    expect(prompts[2]).toBe('she smiles to camera');
    expect(prompts.join(' | ')).not.toMatch(/\d+\s*-\s*\d+\s*s\b/);
  });

  it('rebasea un timeline multi-beat de escena para que empiece en 0 (PD-11)', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'secuencia', formatId: 'f1', customFormat: null, sequenceLabel: 'X',
        scenes: [{ scenePrompt: '13-15s: a wall ignites. 15-17s: the artwork appears', durationS: 4 }],
      }],
    }));
    const res = await matchIdeas({ ideasText: 'secuencia', formats: FORMATS });
    expect(res.matches[0].scenes[0].scenePrompt).toBe('0-2s: a wall ignites. 2-4s: the artwork appears');
  });

  it('quita emojis del scenePrompt (no van dentro del video) y conserva el texto', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'cierre con fuego', formatId: 'f1', customFormat: null,
        scenePrompt: 'The logo glows over the artwork 🔥🔥 and the brand name appears ✨',
      }],
    }));
    const res = await matchIdeas({ ideasText: 'cierre', formats: FORMATS });
    expect(res.matches[0].scenePrompt).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(res.matches[0].scenePrompt).toContain('The logo glows over the artwork');
    expect(res.matches[0].scenePrompt).toContain('the brand name appears');
  });

  it('quita emojis también en las escenas de una secuencia', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'secuencia con emoji', formatId: 'f1', customFormat: null, sequenceLabel: 'X',
        scenes: [{ scenePrompt: 'Hands open the box 🎁 and lift the product', durationS: 5 }],
      }],
    }));
    const res = await matchIdeas({ ideasText: 'secuencia', formats: FORMATS });
    expect(res.matches[0].scenes[0].scenePrompt).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(res.matches[0].scenes[0].scenePrompt).toContain('Hands open the box');
  });

  it('descarta una escena malformada sin tirar la secuencia', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'secuencia', formatId: 'f1', customFormat: null, sequenceLabel: 'X',
        scenes: [
          { scenePrompt: 'Scene one is fully valid and concrete', durationS: 5 },
          { durationS: 5 },
          { scenePrompt: 'Scene three is also valid', durationS: 6 },
        ],
      }],
    }));
    const res = await matchIdeas({ ideasText: 'secuencia', formats: FORMATS });
    expect(res.matches[0].scenes).toHaveLength(2);
    expect(res.matches[0].scenes[1].scenePrompt).toContain('three');
  });

  it('expone el blocker legible cuando el matcher marca una idea no trabajable', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'algo padre', formatId: null, customFormat: null,
        blocker: 'la idea no dice qué pasa en pantalla',
      }],
    }));
    const res = await matchIdeas({ ideasText: 'algo padre', formats: FORMATS });
    expect(res.matches[0].blocker).toBe('la idea no dice qué pasa en pantalla');
  });

  it('blocker ausente o vacío cae a null', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [
        { ideaText: 'un unboxing', formatId: 'f1', customFormat: null },
        { ideaText: 'x', formatId: 'f1', customFormat: null, blocker: '   ' },
      ],
    }));
    const res = await matchIdeas({ ideasText: 'x', formats: FORMATS });
    expect(res.matches[0].blocker).toBeNull();
    expect(res.matches[1].blocker).toBeNull();
  });

  it('idea normal trae scenes vacio (no es secuencia)', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{ ideaText: 'un unboxing', formatId: 'f1', customFormat: null, scenePrompt: 'Hands open the box slowly' }],
    }));
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS });
    expect(res.matches[0].scenes).toEqual([]);
    expect(res.matches[0].sequenceLabel).toBeNull();
  });

  it('parsea characterStateHint de una escena (P05)', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{ ideaText: 'corre y suda', formatId: 'f1', customFormat: null, sequenceLabel: 'X',
        scenes: [{ scenePrompt: 'she runs in the heat', durationS: 5, characterStateHint: 'sudado' }] }],
    }));
    const res = await matchIdeas({ ideasText: 'x', formats: FORMATS });
    expect(res.matches[0].scenes[0].characterStateHint).toBe('sudado');
  });

  it('characterStateHint ausente cae a null', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{ ideaText: 'normal', formatId: 'f1', customFormat: null, sequenceLabel: 'X',
        scenes: [{ scenePrompt: 'she smiles', durationS: 5 }] }],
    }));
    const res = await matchIdeas({ ideasText: 'x', formats: FORMATS });
    expect(res.matches[0].scenes[0].characterStateHint).toBeNull();
  });

  it('pasa los labels de estado del personaje en el pool del prompt', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({ matches: [{ ideaText: 'x', formatId: 'f1', customFormat: null }] }));
    await matchIdeas({ ideasText: 'x', formats: FORMATS, characters: [{ id: 'c1', name: 'Marcela', states: ['sudado', 'mojado'] }] });
    // mismo patrón de assert sobre el argumento del mock que el test existente "las imágenes adjuntas viajan…"
    const parts = gatewayTextMock.mock.calls[0][0].contents[0].parts;
    expect(String(parts[0].text)).toContain('estados: sudado, mojado');
  });

  it('clip único: parsea characterStateHint a nivel idea', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'Marco sudado mostrando el producto', formatId: 'f1', customFormat: null,
        scenePrompt: 'Marco shows the product, sweating',
        characterStateHint: 'sudado',
        scenes: [], count: 1,
      }],
    }));
    const res = await matchIdeas({ ideasText: 'Marco sudado mostrando el producto', formats: FORMATS });
    expect(res.matches[0].characterStateHint).toBe('sudado');
  });

  it('clip único: characterStateHint ausente → null', async () => {
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: 'un unboxing', formatId: 'f1', customFormat: null,
        scenePrompt: 'Hands open the box slowly',
        scenes: [], count: 1,
      }],
    }));
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS });
    expect(res.matches[0].characterStateHint).toBeNull();
  });

  it('ideaText descomunal (>2000) NO descarta el match (brief estructurado)', async () => {

    // Regresión: un brief estructurado largo que el modelo eco-devuelve en
    // ideaText (>2000 chars) tiraba el match entero por `.max(2000)` sin catch
    // → 0 matches → el plan caía al mix genérico. ideaText es solo informativo;
    // debe recortarse, nunca descartar la idea.
    const hugeIdea = 'Plantilla de Campaña: UGC estructurado, cuarto lowkey y jardín. '.repeat(60);
    expect(hugeIdea.length).toBeGreaterThan(2000);
    gatewayTextMock.mockResolvedValue(gatewayOk({
      matches: [{
        ideaText: hugeIdea, formatId: 'f1', customFormat: null,
        scenePrompt: 'Hands open the box slowly', count: 1,
      }],
    }));
    const res = await matchIdeas({ ideasText: hugeIdea, formats: FORMATS });
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0].formatId).toBe('f1');
    expect(res.matches[0].ideaText.length).toBeLessThanOrEqual(2000);
  });
});

describe('buildMatcherSystemPrompt', () => {
  it('incluye las lineas de guia cuando los flags estan activos', () => {
    const withG = buildMatcherSystemPrompt({
      guidelines: { showFullProduct: true, hookProductHero: true },
    });
    expect(withG).toMatch(/producto completo/i);
    expect(withG).toMatch(/hook/i);
  });

  it('sin guias no incluye las lineas de guia', () => {
    const without = buildMatcherSystemPrompt({});
    expect(without).not.toMatch(/producto completo/i);
    expect(without).not.toMatch(/protagonista.*héroe|héroe.*protagonista/i);
  });

  it('solo showFullProduct activo: incluye linea de producto pero no la del hook', () => {
    const s = buildMatcherSystemPrompt({ guidelines: { showFullProduct: true } });
    expect(s).toMatch(/producto completo/i);
    expect(s).not.toMatch(/primer beat.*hook|hook.*encuadra/i);
  });

  it('solo hookProductHero activo: incluye linea del hook pero no la de full product', () => {
    const s = buildMatcherSystemPrompt({ guidelines: { hookProductHero: true } });
    expect(s).toMatch(/hook/i);
    expect(s).not.toMatch(/evita close-ups/i);
  });

  it('es una funcion pura: mismos opts producen el mismo resultado', () => {
    const a = buildMatcherSystemPrompt({ guidelines: { showFullProduct: true } });
    const b = buildMatcherSystemPrompt({ guidelines: { showFullProduct: true } });
    expect(a).toBe(b);
  });

  it('incluye el bloque de física del mundo (los scenePrompt nacen anclados)', () => {
    const s = buildMatcherSystemPrompt({});
    expect(s).toContain('FÍSICA Y COHERENCIA DEL MUNDO');
    expect(s).toContain('nunca flota');
  });

  it('incluye el presupuesto de habla para calibrar durationS al diálogo', () => {
    // El SYSTEM es un template con saltos de línea: se normaliza el whitespace
    // para asertar contenido, no el reflow incidental.
    const s = buildMatcherSystemPrompt({}).replace(/\s+/g, ' ');
    expect(s).toContain('PRESUPUESTO DE HABLA');
    expect(s).toContain('~2 palabras por segundo');
    expect(s).toContain('frases de 5-10 palabras');
  });

  it('incluye la regla de voz en off (Voice-over vs Dialogue) para no forzar lip-sync', () => {
    // Sin esta regla el matcher normalizaba una narración en off a Dialogue: "..."
    // y aguas abajo isVoiceover no disparaba → lip-sync forzado sobre un sujeto de
    // espaldas (bug clip 3/5 del Anuncio #12).
    const s = buildMatcherSystemPrompt({}).replace(/\s+/g, ' ');
    expect(s).toContain('VOZ EN OFF');
    expect(s).toContain('Voice-over:');
  });

  it('fantasía: bloque de estilo presente y física del mundo ausente', () => {
    const s = buildMatcherSystemPrompt({ visualStyle: 'fantasia' });
    expect(s).toContain('FANTASÍA');
    expect(s).not.toContain('FÍSICA Y COHERENCIA DEL MUNDO');
  });

  it('incluye el bloque de actuación (las emociones nacen como gestos pequeños)', () => {
    const s = buildMatcherSystemPrompt({});
    expect(s).toContain('ACTUACIÓN Y EXPRESIONES');
  });

  it('perfil animado/fantasía: sin bloque de actuación (el estilo tolera expresividad)', () => {
    expect(buildMatcherSystemPrompt({ visualStyle: 'animado' })).not.toContain('ACTUACIÓN Y EXPRESIONES');
    expect(buildMatcherSystemPrompt({ visualStyle: 'fantasia' })).not.toContain('ACTUACIÓN Y EXPRESIONES');
  });

  it('custom: el texto del usuario entra al system', () => {
    const s = buildMatcherSystemPrompt({ visualStyle: 'custom', visualStyleCustom: 'acuarela suave' });
    expect(s).toContain('acuarela suave');
    expect(s).toContain('FÍSICA Y COHERENCIA DEL MUNDO');
  });

  it('producto físico grande: bloque de staging proporcional', () => {
    const s = buildMatcherSystemPrompt({ product: { name: 'Canvas', medium: 'canvas', heightCm: 150 } });
    expect(s).toContain('STAGING PROPORCIONAL');
    expect(s).toContain('NO lo pongas en las manos');
  });

  it('con peso: bloque de peso; sin datos físicos: ninguno', () => {
    expect(buildMatcherSystemPrompt({ product: { name: 'x', weightKg: 25 } })).toContain('PESO DEL PRODUCTO');
    expect(buildMatcherSystemPrompt({ product: { name: 'x' } })).not.toContain('STAGING PROPORCIONAL');
    expect(buildMatcherSystemPrompt({})).not.toContain('PESO DEL PRODUCTO');
  });
});
