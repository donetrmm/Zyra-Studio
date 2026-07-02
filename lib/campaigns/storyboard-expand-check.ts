import sharp from 'sharp';
import { z } from 'zod';

// Verificador anti-texto de las bandas del expand 9:16. FLUX outpaint ignora el
// "no text" del prompt con frecuencia (rellena la banda con title cards de texto
// inventado, sobre todo en fondos de estudio); el prompt solo no basta, asi que
// el gate es estructural: se recortan las DOS bandas extendidas y un modelo de
// vision barato responde si contienen tipografia. Fail-open: si el verificador
// mismo falla (API caida, respuesta rara) NO bloquea el panel — el gate es un
// filtro de calidad, no un punto unico de fallo.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const CHECK_MODEL = 'gemini-2.5-flash';

const CHECK_PROMPT =
  'These two images are the extended top and bottom bands of a vertical advertising frame. ' +
  'Reply with strict JSON: {"hasText": true} or {"hasText": false}. ' +
  'hasText is true if ANY letters, words, numbers, captions, titles, subtitles, logos with lettering, ' +
  'watermarks or typographic symbols are visible in EITHER image. ' +
  'Photographic content, plain shapes or textures without lettering do not count.';

// Variante para el PANEL BASE antes de expandir: Nano a veces quema el diálogo
// del beat como subtítulo al pie del 4:5 (pese al noText del prompt). Se revisa
// solo la franja inferior — ahí viven subtítulos y captions publicitarios.
const BASE_CHECK_PROMPT =
  'This image is the bottom strip of a still advertising frame. ' +
  'Reply with strict JSON: {"hasText": true} or {"hasText": false}. ' +
  'hasText is true if ANY letters, words, numbers, captions, subtitles, titles, logos with lettering, ' +
  'watermarks or typographic symbols are visible. ' +
  'Photographic content, plain shapes or textures without lettering do not count.';

const CheckSchema = z.object({ hasText: z.boolean() });

// Extrae el veredicto del JSON crudo de Gemini. Puro (testeable): devuelve null
// cuando la respuesta no trae un veredicto parseable.
export function parseTextCheck(json: unknown): boolean | null {
  const text = (json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    ?.candidates?.[0]?.content?.parts?.find((p) => typeof p?.text === 'string')?.text;
  if (!text) return null;
  try {
    const parsed = CheckSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.hasText : null;
  } catch {
    return null;
  }
}

// Núcleo compartido de los gates: manda las franjas al verificador de visión y
// devuelve el veredicto. Fail-open: cualquier fallo del verificador (API caída,
// respuesta rara) devuelve false — es un filtro de calidad, no un punto único
// de fallo.
async function stripsHaveText(prompt: string, strips: Buffer[]): Promise<boolean> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return false;
    const res = await fetch(`${ENDPOINT}/${CHECK_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              ...strips.map((s) => ({ inline_data: { mime_type: 'image/jpeg', data: s.toString('base64') } })),
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 60,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) {
      console.error('[storyboard-expand-check] verificador no disponible', { status: res.status });
      return false;
    }
    const verdict = parseTextCheck(await res.json());
    if (verdict === null) {
      console.error('[storyboard-expand-check] veredicto no parseable');
      return false;
    }
    return verdict;
  } catch (err) {
    console.error('[storyboard-expand-check] fallo el verificador', { error: (err as Error)?.message });
    return false;
  }
}

// Recorta las bandas superior e inferior (bandPx) del resultado expandido y
// pregunta al verificador si contienen texto. true = hay texto (reintentar).
export async function expandedBandsHaveText(expanded: Buffer, bandPx: number): Promise<boolean> {
  try {
    const meta = await sharp(expanded).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height || bandPx <= 0 || bandPx * 2 >= height) return false;

    const topBand = await sharp(expanded).extract({ left: 0, top: 0, width, height: bandPx }).jpeg().toBuffer();
    const bottomBand = await sharp(expanded)
      .extract({ left: 0, top: height - bandPx, width, height: bandPx })
      .jpeg()
      .toBuffer();
    return await stripsHaveText(CHECK_PROMPT, [topBand, bottomBand]);
  } catch (err) {
    console.error('[storyboard-expand-check] fallo el verificador', { error: (err as Error)?.message });
    return false;
  }
}

// Gate del PANEL BASE antes de expandir (bug 2026-07-02): si Nano quemó el
// diálogo como subtítulo al pie del 4:5, el expand solo continúa esa franja y el
// gate de bandas falla determinista al reintentar con la MISMA base — con un
// error que culpaba al expand. Detectarlo aquí ahorra los intentos de expand y
// da el motivo real. true = hay texto al pie de la base.
export async function baseBottomHasText(base: Buffer, stripPx: number): Promise<boolean> {
  try {
    const meta = await sharp(base).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height || stripPx <= 0 || stripPx >= height) return false;

    const bottomStrip = await sharp(base)
      .extract({ left: 0, top: height - stripPx, width, height: stripPx })
      .jpeg()
      .toBuffer();
    return await stripsHaveText(BASE_CHECK_PROMPT, [bottomStrip]);
  } catch (err) {
    console.error('[storyboard-expand-check] fallo el verificador de base', { error: (err as Error)?.message });
    return false;
  }
}
