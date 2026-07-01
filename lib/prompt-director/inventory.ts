// Extracción de inventario y reglas duras de contenido (specs/v2/02 tarea 2).
// El director nunca inventa atributos de producto/marca, nunca fabrica claims
// y nunca describe personajes por edad (regla age-blind).

import type { CharacterInventory, ProductInventory } from './types';

// Claims de performance que el director NO puede fabricar ni dejar pasar
// (solo lo visible y audible en escena).
const CLAIM_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bclinically (proven|tested)\b/gi, label: 'clinically proven/tested' },
  { re: /\bscientifically (proven|tested)\b/gi, label: 'scientifically proven/tested' },
  { re: /\bdoctor[- ]recommended\b/gi, label: 'doctor recommended' },
  { re: /\b\d+\s*x\s+(faster|better|stronger|more)\b/gi, label: 'Nx faster/better' },
  { re: /\bguaranteed (results?|to)\b/gi, label: 'guaranteed results' },
  { re: /\b(cures?|heals?)\b/gi, label: 'cures/heals' },
  { re: /\bmiracle\b/gi, label: 'miracle' },
  { re: /\b#\s?1\b|\bnumber one\b|\bel mejor del mundo\b|\bbest in the world\b/gi, label: '#1 / best in the world' },
  { re: /\bcl[ií]nicamente (probado|comprobado)\b/gi, label: 'clínicamente probado' },
  { re: /\bgarantizad[oa]\b/gi, label: 'garantizado' },
];

// Marcadores de edad prohibidos en descripciones de personaje (en/es).
const AGE_WORDS = [
  'boy', 'girl', 'child', 'children', 'kid', 'kids', 'teen', 'teenager',
  'young', 'youthful', 'little', 'elderly', 'old man', 'old woman', 'aged',
  'niño', 'niña', 'niños', 'niñas', 'chico', 'chica', 'joven', 'jóvenes',
  'adolescente', 'anciano', 'anciana', 'viejo', 'vieja', 'pequeño', 'pequeña',
] as const;

const AGE_REGEXES = AGE_WORDS.map(
  (w) => new RegExp(`\\b${w}\\b`, 'gi'),
);

export function findClaims(text: string): string[] {
  const found: string[] = [];
  for (const { re, label } of CLAIM_PATTERNS) {
    if (re.test(text)) found.push(label);
    re.lastIndex = 0;
  }
  return found;
}

export function findAgeWords(text: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < AGE_REGEXES.length; i++) {
    const re = AGE_REGEXES[i];
    if (re.test(text)) found.push(AGE_WORDS[i]);
    re.lastIndex = 0;
  }
  return found;
}

export function stripAgeWords(text: string): { text: string; removed: string[] } {
  const removed = findAgeWords(text);
  if (removed.length === 0) return { text, removed };
  let out = text;
  for (const re of AGE_REGEXES) {
    out = out.replace(re, '');
    re.lastIndex = 0;
  }
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
  return { text: out, removed };
}

// Frase de fidelidad del producto: usa SOLO los campos declarados.
// `fidelity: false` omite la cláusula de fidelidad cuando la línea @image ya la
// declara (evita duplicar verbatim y gastar el techo de caracteres en Seedance).
// Sin imágenes de referencia (text2video con producto suelto) NO se puede pedir
// "como en las imágenes": se ancla a los atributos declarados y se prohíbe
// inventar el resto — antes apuntaba a imágenes inexistentes (instrucción muerta).
export function describeProduct(
  product: ProductInventory,
  opts: { fidelity?: boolean } = {},
): string {
  let facts: string;
  if (product.medium) {
    const displays = product.visualDetails
      ? ` that displays this printed image: ${product.visualDetails}`
      : '';
    const colors = product.palette?.length ? ` Printed colors: ${product.palette.join(', ')}.` : '';
    const thin = product.thicknessMm
      ? ` It is about ${product.thicknessMm} mm thin at the edge; do not render a thick block frame or a deep gallery-wrap, keep the edge slim.`
      : '';
    // La cláusula de no-distorsión existe porque el modelo tiende a estirar el
    // arte impreso para llenar el lienzo que renderizó (personas alargadas,
    // composición recompuesta) en vez de respetar las proporciones del arte.
    facts = `Product: a ${product.medium}${displays}.${colors} The product itself is the physical ${product.medium}; the depicted content is only printed on its surface, not separate physical objects. Reproduce the printed artwork exactly as in the product reference images — undistorted and unstretched, preserving the artwork's own proportions and composition; never invent, recolor or replace the printed content.${thin}`;
  } else {
    const parts = [`Product: ${product.name}`];
    if (product.visualDetails) parts.push(product.visualDetails);
    if (product.palette?.length) parts.push(`brand colors ${product.palette.join(', ')}`);
    facts = `${parts.join(', ')}.`;
  }
  if (opts.fidelity === false) return facts;
  if (!product.imagePaths.length) {
    return `${facts} Render the product exactly with these declared attributes; do not invent packaging, colors, logo or any detail that is not listed.`;
  }
  // Arbitraje explícito: el planner a veces re-describe el producto en la toma
  // ("framed canvas" cuando es sin marco) y el modelo obedece al texto más
  // cercano. La referencia y la ficha SIEMPRE ganan sobre el texto de la toma.
  return `${facts} The product must appear exactly as shown in its reference images — same packaging, colors, logo placement and proportions. Never restyle the product. If the shot description contradicts the product's construction, frame, size, colors or printed content, the product reference images and this description always win.`;
}

// Descripción de personaje age-blind, por apariencia y manera de actuar.
// `fidelity: false` omite la cláusula de "apariencia exacta" cuando la línea
// @image del Cast ya la declara. Sin hoja maestra (personaje inventado por el
// planner) la descripción ES la apariencia: se pide consistencia, NO se apunta a
// una imagen de referencia inexistente (antes lo hacía: instrucción muerta).
export function describeCharacter(
  character: CharacterInventory,
  opts: { fidelity?: boolean } = {},
): {
  text: string;
  ageWordsRemoved: string[];
} {
  const { text, removed } = stripAgeWords(character.description);
  const base = `${character.name}: ${text}.`;
  if (opts.fidelity === false) {
    return { text: base, ageWordsRemoved: removed };
  }
  const clause = character.masterImagePath
    ? ' Exact appearance as in the character reference image — same face, same hair, same build.'
    : ' Keep this exact appearance consistent in every shot.';
  return { text: `${base}${clause}`, ageWordsRemoved: removed };
}

// Referencia de estatura de un adulto de pie. La escala del producto se expresa
// como proporción contra esta altura porque los personajes son age-blind y no
// tienen estatura en el modelo.
export const ADULT_REF_CM = 170;

// Ancla de ESCALA del producto para el storyboard (specs/.../escala-producto).
// Traduce el tamaño físico declarado (heightCm/widthCm, opcionales) a una frase
// de proporción contra un adulto de pie y pide mantenerla constante entre tomas.
// Devuelve '' si no hay producto o no hay dimensiones (productos sin tamaño
// relevante no se ven afectados). Empieza con espacio (lista para concatenar).
// Es de escala/proporción, NO de identidad: no arrastra el riesgo de re-render
// de las cláusulas de personaje. Asume el producto mostrado vertical.
// Redondea una proporción a 1 decimal y recorta el ".0" ("1.5", "2").
function trimRatio(n: number): string {
  return String(Math.round(n * 10) / 10);
}

export function describeProductScale(product?: ProductInventory): string {
  if (!product) return '';
  const size = product.heightCm ?? product.widthCm;
  if (!size || size <= 0) return '';
  const ratio = size / ADULT_REF_CM;
  // Las bandas altas dicen "clearly shorter than the person": el fallo observado
  // (canvas 150cm renderizado como panel de 2m+ que supera a la persona) es
  // agrandar, no encoger — el ancla necesita el límite superior explícito.
  const proportion =
    ratio < 0.12 ? 'small enough to hold in one hand'
    : ratio < 0.25 ? 'about knee-high on a standing adult'
    : ratio < 0.45 ? 'about thigh-to-waist high on a standing adult'
    : ratio < 0.60 ? 'about waist-to-chest high on a standing adult'
    : ratio < 0.80 ? "its top edge reaching an adult's chest, clearly shorter than the person"
    : ratio < 0.95 ? "its top edge reaching an adult's shoulders, clearly shorter than the person"
    : ratio < 1.10 ? 'about as tall as a standing adult'
    : 'taller than a standing adult';
  const dims =
    product.heightCm && product.widthCm
      ? `about ${product.heightCm} cm tall and ${product.widthCm} cm wide`
      : product.heightCm
        ? `about ${product.heightCm} cm tall`
        : `about ${product.widthCm} cm wide`;
  // Proporción explícita del rectángulo cuando hay ambas dimensiones: el modelo
  // respeta mejor "1.5 times taller than wide" que las medidas absolutas en cm.
  let shape = '';
  if (product.heightCm && product.widthCm && product.heightCm > 0 && product.widthCm > 0) {
    const h = product.heightCm;
    const w = product.widthCm;
    if (Math.abs(h - w) / Math.max(h, w) < 0.05) {
      shape = ', a square';
    } else if (h > w) {
      shape = `, a vertical rectangle ${trimRatio(h / w)} times taller than it is wide`;
    } else {
      shape = `, a horizontal rectangle ${trimRatio(w / h)} times wider than it is tall`;
    }
    shape += ' — keep this exact aspect ratio';
  }
  return ` The product is a physical piece, ${dims}${shape} - ${proportion}. Render it at this real-world scale and proportion relative to the people, and keep that size constant in every shot; do not shrink or enlarge it between shots, do not exaggerate it into an oversized floor-to-ceiling piece, and do not miniaturize it.`;
}
