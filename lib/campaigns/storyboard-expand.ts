import sharp from 'sharp';
import { ProviderError } from '@/lib/providers/types';
import { expand } from '@/lib/providers/flux-expand';
import { safeAreaBands } from '@/lib/images/safe-area';
import { expandedBandsHaveText, baseBottomHasText } from './storyboard-expand-check';

// Tres intentos como maximo: BFL randomiza la semilla por request, asi que cada
// retry produce bandas distintas (en fondos oscuros la tendencia a title cards
// es alta y dos intentos se quedaban cortos — observado 2026-07-02). Si el texto
// reincide, fallar limpio (refund + warning accionable) es mejor que servir un
// panel con rotulos inventados.
export const MAX_EXPAND_ATTEMPTS = 3;

// Resultado de UN intento de expand: ok:false = texto en las bandas y quedan
// intentos — el worker re-encola el siguiente hop (nunca se reintenta inline).
export type ExpandAttemptOutcome =
  | { ok: true; buffer: Buffer; mimeType: string }
  | { ok: false };

// Franja inferior de la base a revisar antes de expandir (fraccion de la altura):
// cubre la zona donde Nano quema subtitulos/captions.
const BASE_TEXT_STRIP_RATIO = 0.18;

// Expande una base 4:5 a 9:16 con FLUX.1 Expand (outpaint con mascara). Agrega
// bandas reales arriba y abajo preservando el centro 4:5. NO hace fallback: si el
// expand cae (endpoint no disponible, 402, timeout, moderado) deja propagar el
// ProviderError para que el worker falle limpio (fail + refund). El prompt es NEUTRO
// a proposito: el expand continua el fondo que ya ve, no necesita la escena, y asi se
// reduce la superficie de moderacion de BFL y se evita inventar un sujeto en las bandas.
//
// UN intento por invocación (incidente 2026-07-03): el loop de 3 intentos inline
// (expand + check de visión cada uno, más el gate de la base) excedía el
// maxDuration de 60s del worker; Vercel mataba la función sin pasar por toFail y
// la generación quedaba en 'processing' para siempre (QStash agotaba reintentos
// contra la misma vía lenta). El reintento vive ahora en hops de QStash: si hay
// texto y quedan intentos, devolvemos ok:false y el handler re-encola con
// expand_attempt+1 (presupuesto fresco de 60s por intento).
export async function extendPanelTo916Attempt(
  base: { buffer: Buffer; mimeType: string },
  attempt: number,
  sceneHint?: string,
): Promise<ExpandAttemptOutcome> {
  const meta = await sharp(base.buffer).metadata();
  const width = meta.width ?? 0;
  if (!width) {
    throw new ProviderError('zona segura: no se pudo leer el ancho de la base', 'invalid_input', false);
  }
  // Gate del PANEL BASE (bug 2026-07-02): Nano a veces quema el dialogo del beat
  // como subtitulo al pie del 4:5 pese al noText. Expandir esa base es dinero
  // tirado (el gate de bandas la va a tirar N veces con el MISMO defecto) y el
  // error resultante culpaba al expand. Fail-open como el gate de bandas. Solo en
  // el intento 1: la base no cambia entre hops y re-checarla quema una llamada de
  // visión por intento.
  const baseHeight = meta.height ?? 0;
  if (
    attempt <= 1 &&
    baseHeight &&
    (await baseBottomHasText(base.buffer, Math.round(baseHeight * BASE_TEXT_STRIP_RATIO)))
  ) {
    throw new ProviderError(
      'el panel base trae texto o subtitulos quemados al pie; regenera el panel',
      'unknown',
      false,
    );
  }
  const { bandPx } = safeAreaBands(width);
  // El refuerzo anti-texto existe porque FLUX outpaint tiende a rellenar bandas
  // grandes (sobre todo la inferior en fondos oscuros) con rotulos/title cards
  // de texto inventado, ignorando un "do not add text" generico. El hint de
  // escenografia (locacion configurada) evolucionó el prompt "neutro" original:
  // sin ancla, FLUX inventaba escenografia ajena a la locacion en las bandas.
  const scenery = sceneHint?.trim()
    ? ` The scene being extended is: ${sceneHint.trim()}. The new areas must belong to that same place.`
    : '';
  const prompt =
    `Extend the existing image naturally above and below into a taller vertical frame: continue the same background, walls, floor, sky, lighting and colors already present in the image.${scenery} Do not add, remove, or change any people, products, text or objects; only extend the empty surroundings. Absolutely no text of any kind in the extended areas: no letters, words, captions, titles, subtitles, logos, watermarks or lettering; no graphic bands, borders, panels or title cards — photographic continuation of the scenery only.`;
  const result = await expand({ image: base.buffer, top: bandPx, bottom: bandPx, prompt });
  const hasText = await expandedBandsHaveText(result.buffer, bandPx);
  if (!hasText) return { ok: true, buffer: result.buffer, mimeType: result.mimeType };
  console.error('[storyboard-expand] texto detectado en las bandas extendidas', { attempt });
  if (attempt < MAX_EXPAND_ATTEMPTS) return { ok: false };
  throw new ProviderError(
    `la extension a 9:16 agrego texto o rotulos en las bandas en ${MAX_EXPAND_ATTEMPTS} intentos; regenera el panel`,
    'unknown',
    false,
  );
}
