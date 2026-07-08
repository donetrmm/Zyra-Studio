import 'server-only';
import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';
import { gatewayText, type GatewayPart } from '@/lib/providers/gateway';

// Análisis por visión de las imágenes de producto del brand kit (botón
// "Analizar con IA" del selector de referencias): deriva el USO de cada imagen
// (qué vista es y qué fija: frontal/arte, perfil/grosor, detalle/acabado) y
// PROPONE hechos de construcción para el brief (medium, thicknessMm,
// visualDetails). Nada se aplica solo: el usuario confirma y lo aplicado se
// persiste en la FUENTE (media_references.usage_description + product_brief),
// nunca por generación — misma filosofía que el perfil de luz de locaciones
// (deriveLightProfileFromImage), cuyo patrón de llamada se espeja aquí.

const MODEL = 'gemini-2.5-flash';

// Los usos y visualDetails van EN INGLÉS: se citan dentro de prompts en inglés
// (compilers y pointers de chat).
const SYSTEM = `Eres fotógrafo de producto. Observa las imágenes numeradas de UN MISMO producto físico y devuelve SOLO un JSON con esta forma exacta:
{"images":[{"index":1,"usage":"en INGLÉS, máx 12 palabras"}],"medium":"en INGLÉS o null","thicknessMm":número o null,"visualDetails":"en INGLÉS, 1 frase o null"}
Reglas: "usage" dice qué vista es y qué fija esa imagen (ej. "front view of the printed artwork", "edge profile showing the slim ~18mm depth", "close-up of the matte finish"). "medium" es el soporte físico (ej. "canvas print", "framed poster", "ceramic mug") solo si es inequívoco. "thicknessMm" SOLO si alguna imagen muestra el canto/perfil y permite estimarlo; si no, null. "visualDetails" describe el contenido impreso/visual del producto. Solo lo VISIBLE — no inventes atributos, medidas ni materiales que las imágenes no muestren. JSON válido, sin markdown.`;

const ReplySchema = z.object({
  images: z.array(z.object({ index: z.number(), usage: z.string() })).max(12),
  medium: z.string().nullable().optional(),
  thicknessMm: z.number().nullable().optional(),
  visualDetails: z.string().nullable().optional(),
});

export type ReferenceAnalysisProposal = {
  usages: { path: string; usage: string }[];
  brief: { medium?: string; thicknessMm?: number; visualDetails?: string };
};

// Grosores fuera de (0, 300] mm son alucinación segura para los productos del
// dominio (cuadros, pósters, objetos de mesa): se descartan sin tirar el resto.
const MAX_PLAUSIBLE_THICKNESS_MM = 300;

// Pura (testeable sin API): valida la respuesta del modelo y la mapea a la
// propuesta. Índices 1-based sobre el orden de `paths`; entradas inválidas se
// descartan una a una, la forma global inválida lanza.
export function parseAnalysisReply(json: unknown, paths: string[]): ReferenceAnalysisProposal {
  const reply = ReplySchema.safeParse(json);
  if (!reply.success) {
    throw new ProviderError('El análisis de referencias no cumple el schema', 'unknown', false);
  }
  const usages: { path: string; usage: string }[] = [];
  for (const img of reply.data.images) {
    const path = Number.isInteger(img.index) ? paths[img.index - 1] : undefined;
    const usage = img.usage.trim();
    if (!path || !usage) continue;
    usages.push({ path, usage: usage.slice(0, 300) });
  }
  const brief: ReferenceAnalysisProposal['brief'] = {};
  const medium = reply.data.medium?.trim();
  if (medium) brief.medium = medium.slice(0, 120);
  const thickness = reply.data.thicknessMm;
  if (typeof thickness === 'number' && thickness > 0 && thickness <= MAX_PLAUSIBLE_THICKNESS_MM) {
    brief.thicknessMm = Math.round(thickness);
  }
  const visualDetails = reply.data.visualDetails?.trim();
  if (visualDetails) brief.visualDetails = visualDetails.slice(0, 600);
  return { usages, brief };
}

// Una sola llamada multi-imagen (las vistas se explican entre sí: el perfil
// desambigua el grosor que la frontal no muestra). <10s con Flash — permitido
// en server action, igual que el perfil de luz.
export async function analyzeProductImages(
  images: { path: string; buffer: Buffer; mimeType: string }[],
): Promise<ReferenceAnalysisProposal> {
  if (images.length === 0) return { usages: [], brief: {} };

  const parts: GatewayPart[] = [];
  images.forEach((img, i) => {
    parts.push({ text: `Imagen ${i + 1}:` });
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.buffer.toString('base64') } });
  });
  parts.push({ text: 'Analiza las imágenes del producto y devuelve el JSON.' });

  const { text: raw } = await gatewayText({
    model: MODEL,
    label: 'análisis',
    system: SYSTEM,
    contents: [{ role: 'user', parts }],
    temperature: 0.2,
    maxOutputTokens: 600,
    json: true,
  });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ProviderError('Gemini devolvió JSON inválido al analizar referencias', 'unknown', false);
  }
  return parseAnalysisReply(
    json,
    images.map((i) => i.path),
  );
}
