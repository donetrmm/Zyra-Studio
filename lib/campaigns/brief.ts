import 'server-only';
import { lookup } from 'node:dns/promises';
import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';

// Auto-detección del brief (specs/v2/03 tarea 2): con la imagen del producto
// inferir categoría, variantes, paleta y demográfico. Principio del doc V2:
// nunca preguntar lo que se puede inferir. Usa el mismo Gemini Flash del
// prompt-enhancer (rápido, <10s, permitido en server action).

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

export const PRODUCT_CATEGORIES = [
  'beverage', 'food', 'beauty', 'apparel', 'accessories',
  'electronics', 'software', 'home', 'fitness', 'other',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const ProductBriefSchema = z.object({
  productName: z.string().min(1).max(120),
  category: z.enum(PRODUCT_CATEGORIES),
  variants: z.array(z.string().max(60)).max(12).default([]),
  palette: z.array(z.string().max(40)).max(6).default([]),
  // Detalles visibles del empaque: material, forma, acabado, tipografía.
  // Cap holgado (800): en text2video es la ÚNICA descripción del producto que
  // recibe el modelo, así que conviene que sea rica sin llegar a keyword soup.
  visualDetails: z.string().max(800).default(''),
  demographic: z.string().max(160).default(''),
  market: z.string().max(80).default('global'),
  // Tamaño físico del producto (opcional). Solo productos con tamaño relevante.
  // Cap 2000 cm para atrapar typos. Lo provee el usuario; la IA del brief NO lo
  // infiere (no se deduce de una foto sin referencia).
  heightCm: z.number().positive().max(2000).optional(),
  widthCm: z.number().positive().max(2000).optional(),
});
export type ProductBrief = z.infer<typeof ProductBriefSchema>;

const SYSTEM = `Eres un estratega de marketing. Analiza la imagen del producto y devuelve SOLO un JSON con esta forma exacta:
{
  "productName": "nombre visible o descriptivo corto",
  "category": "beverage|food|beauty|apparel|accessories|electronics|software|home|fitness|other",
  "variants": ["variantes/sabores/SKUs visibles, si los hay"],
  "palette": ["2-4 colores dominantes del empaque, en inglés"],
  "visualDetails": "descripción visual densa del producto/empaque, en inglés, 2-3 frases: material, forma, acabado, color, tipografía visible y cualquier elemento distintivo (tapa, etiqueta, textura)",
  "demographic": "demográfico aparente del producto, breve",
  "market": "mercado aparente (global salvo señales claras de región)"
}
Reglas: describe SOLO lo visible — no inventes claims, ingredientes ni atributos. Si no hay variantes visibles, variants=[]. JSON válido, sin markdown.`;

const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string() })).optional() }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .min(1),
});

// Fetch server-side de la URL del producto (specs/v2/03 tarea 2): el texto de
// la página (título, descripción, claims, tono) se pasa como extraContext al
// análisis del brief. Guardas anti-SSRF: solo http(s), hostname Y todas sus
// IPs resueltas fuera de rangos internos, redirecciones manuales re-validadas
// hop a hop, timeout 10s, respuesta acotada.
// Riesgo residual documentado: DNS rebinding entre lookup y connect (mitigarlo
// requiere un agent con lookup propio que fije la IP; fuera de alcance demo).
const URL_TIMEOUT_MS = 10_000;
const URL_MAX_BYTES = 1_500_000;
const URL_TEXT_CAP = 4000;
const URL_MAX_REDIRECTS = 5;

export function isPrivateIp(address: string): boolean {
  const ip = address.toLowerCase();
  if (ip.includes(':')) {
    // IPv6: loopback, unspecified, ULA fc00::/7, link-local fe80::/10.
    if (ip === '::1' || ip === '::') return true;
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(ip)) return true;
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(ip);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return true; // forma ilegible: bloquear por precaución
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

// Valida nombre + resolución DNS: un dominio público puede apuntar su A/AAAA
// a una IP interna; se rechaza si CUALQUIER dirección resuelta es privada.
async function assertPublicHost(hostname: string): Promise<void> {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    throw new ProviderError('URL no permitida', 'unknown', false);
  }
  if (/^[\d.]+$/.test(h) || h.includes(':')) {
    if (isPrivateIp(h)) throw new ProviderError('URL no permitida', 'unknown', false);
    return;
  }
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(h, { all: true });
  } catch {
    throw new ProviderError('No se pudo resolver el host de la URL', 'unknown', false);
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new ProviderError('URL no permitida', 'unknown', false);
  }
}

export function htmlToText(html: string): string {
  // Título + meta description primero: suelen concentrar nombre y claims.
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  const metaDesc =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(html)?.[1] ??
    '';
  const ogDesc =
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? '';
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [title.trim(), metaDesc.trim(), ogDesc.trim(), body]
    .filter(Boolean)
    .join('\n')
    .slice(0, URL_TEXT_CAP);
}

function assertHttpProtocol(url: URL): void {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ProviderError('Solo URLs http(s)', 'unknown', false);
  }
}

export async function fetchProductPageText(rawUrl: string): Promise<string> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new ProviderError('URL de producto inválida', 'unknown', false);
  }
  assertHttpProtocol(current);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_TIMEOUT_MS);
  try {
    // Redirecciones manuales: cada hop se re-valida (protocolo + host + DNS)
    // para que un destino público no redirija a un host interno.
    let res: Response | undefined;
    for (let hop = 0; hop <= URL_MAX_REDIRECTS; hop++) {
      await assertPublicHost(current.hostname);
      res = await fetch(current.toString(), {
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'User-Agent': '1to1Studio/1.0 (product brief)' },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) throw new ProviderError('Redirección sin destino', 'unknown', false);
        if (hop === URL_MAX_REDIRECTS) {
          throw new ProviderError('Demasiadas redirecciones', 'unknown', false);
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new ProviderError('Redirección a una URL inválida', 'unknown', false);
        }
        assertHttpProtocol(next);
        current = next;
        continue;
      }
      break;
    }
    if (!res) throw new ProviderError('Sin respuesta de la página', 'unknown', false);
    if (!res.ok) {
      throw new ProviderError(`La página respondió ${res.status}`, 'server', false);
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      throw new ProviderError('La URL no es una página de producto (HTML)', 'unknown', false);
    }
    const raw = await res.text();
    const html = raw.length > URL_MAX_BYTES ? raw.slice(0, URL_MAX_BYTES) : raw;
    const text = htmlToText(html);
    if (!text) throw new ProviderError('La página no tiene texto legible', 'unknown', false);
    return text;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if ((e as Error).name === 'AbortError') {
      throw new ProviderError('La página tardó demasiado en responder', 'timeout', false);
    }
    throw new ProviderError(`No se pudo leer la URL: ${(e as Error).message}`, 'unknown', false);
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeProductBrief(input: {
  imageBuffer: Buffer;
  mimeType: string;
  // Texto extra opcional (ej. contenido de la URL de la tienda).
  extraContext?: string;
}): Promise<ProductBrief> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);

  const parts: Array<Record<string, unknown>> = [
    { inline_data: { mime_type: input.mimeType, data: input.imageBuffer.toString('base64') } },
  ];
  if (input.extraContext) {
    parts.push({ text: `Contexto adicional del producto:\n${input.extraContext.slice(0, 4000)}` });
  }
  parts.push({ text: 'Analiza el producto y devuelve el JSON.' });

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1000,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (res.status === 429) throw new ProviderError('Rate limit Gemini', 'rate_limit', true);
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('Auth inválida con Gemini API', 'auth', false);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`Gemini brief ${res.status}: ${text.slice(0, 200)}`, 'server', res.status >= 500);
  }

  const parsed = GeminiResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ProviderError('Respuesta inesperada de Gemini en brief', 'unknown', false);
  }
  const raw = (parsed.data.candidates[0].content?.parts ?? []).map((p) => p.text).join('');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ProviderError('Gemini devolvió JSON inválido en brief', 'unknown', false);
  }
  const brief = ProductBriefSchema.safeParse(json);
  if (!brief.success) {
    throw new ProviderError(`Brief no cumple el schema: ${brief.error.message.slice(0, 200)}`, 'unknown', false);
  }
  return brief.data;
}
