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

export function describeProductScale(
  product?: ProductInventory,
  opts?: { staging?: boolean },
): string {
  if (!product) return '';
  const heightRef = product.heightCm ?? product.widthCm;
  if (!heightRef || heightRef <= 0) return '';
  // La dimensión DOMINANTE decide "pieza grande": un panel 100x20cm es grande
  // por su ancho aunque su alto (20cm) sea chico — usar solo heightCm subestimaba
  // piezas anchas-y-bajas (fallo observado: "cabe en una mano" para un panel de
  // 1 metro de largo).
  const maxDim = Math.max(product.heightCm ?? 0, product.widthCm ?? 0);
  const ratio = maxDim / ADULT_REF_CM;
  const widthDominant = (product.widthCm ?? 0) > (product.heightCm ?? 0);
  // Las bandas altas dicen "clearly shorter than the person": el fallo observado
  // (canvas 150cm renderizado como panel de 2m+ que supera a la persona) es
  // agrandar, no encoger — el ancla necesita el límite superior explícito.
  // Con dimensión dominante = ancho, la escalera describe el LADO MÁS LARGO
  // como longitud (no como altura del objeto, que sería engañoso).
  const proportion = widthDominant
    ? ratio < 0.12 ? 'small enough to hold in one hand'
      : ratio < 0.25 ? "its longest side about knee-height of a standing adult"
      : ratio < 0.45 ? "its longest side about thigh-to-waist height of a standing adult"
      : ratio < 0.60 ? "its longest side about waist-to-chest height of a standing adult"
      : ratio < 0.80 ? "its longest side about chest-height of a standing adult"
      : ratio < 0.95 ? "its longest side about shoulder-height of a standing adult"
      : ratio < 1.10 ? 'its longest side about as long as a standing adult is tall'
      : 'its longest side longer than a standing adult is tall'
    : ratio < 0.12 ? 'small enough to hold in one hand'
      : ratio < 0.25 ? 'about knee-high on a standing adult'
      : ratio < 0.45 ? 'about thigh-to-waist high on a standing adult'
      : ratio < 0.60 ? 'about waist-to-chest high on a standing adult'
      : ratio < 0.80 ? "its top edge reaching an adult's chest, clearly shorter than the person"
      : ratio < 0.95 ? "its top edge reaching an adult's shoulders, clearly shorter than the person"
      : ratio < 1.10 ? 'about as tall as a standing adult'
      : 'taller than a standing adult';
  // Ancla de interaccion: sin ella el modelo encoge piezas grandes a objeto de
  // mano cuando un personaje las sostiene (fallo observado: canvas de 150cm
  // sostenido con una mano como si fuera un libro).
  const carry =
    ratio < 0.45 ? ''
    : ratio < 0.60 ? ' If a person holds it, it takes both hands and covers them from waist to chest; it is never a small hand-held object.'
    : ratio < 0.80 ? ' If a person carries it, it takes both arms and covers them from thighs to chest; never render it as a small hand-held object.'
    : ratio < 1.10 ? ' If a person carries it, it takes both arms and covers them from knees to shoulders; never render it as a small hand-held board.'
    : ' Carrying it visibly dwarfs a single person; it cannot be casually held.';
  // Staging/encuadre para piezas grandes (spec 2026-07-02): la preferencia es
  // NO cargarla — colocada como ese TIPO de objeto reposa naturalmente (sin
  // lista cerrada: el modelo decide por lo que ES el producto) y con la cámara
  // suficientemente atrás para que quepa completa a escala real. Reconcilia el
  // safe crop: "grande" se logra alejando cámara, nunca rompiendo proporción.
  // La excepción (cargar/mover/entregar explícito, o un close-up/detail shot
  // deliberado) la cubre el carve-out inicial + `carry`.
  // `opts.staging === false` la omite entera: el refinado sandwich (edición
  // conversacional) preserva composición y una directiva activa de re-encuadre
  // ahí causa drift — ver compileRefinePrompt en lib/campaigns/storyboard.ts.
  const staging =
    opts?.staging !== false && ratio >= 0.45
      ? ' Unless the beat is a deliberate close-up or detail shot, or the scene explicitly shows a person carrying, moving or handing it over, show the piece supported or placed the way this kind of object naturally rests in a real space, with any people beside it; frame the shot wide enough — pulling the camera back if needed — so the whole piece fits in frame at true scale next to the people. Never shrink the piece to make it fit the frame.'
      : '';
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
  return ` The product is a physical piece, ${dims}${shape} - ${proportion}. Render it at this real-world scale and proportion relative to the people, and keep that size constant in every shot; do not shrink or enlarge it between shots, do not exaggerate it into an oversized floor-to-ceiling piece, and do not miniaturize it.${carry}${staging}`;
}

// Explica QUÉ muestra cada imagen de producto adjunta (usage_description del
// brand kit) y exige calzar la construcción que cada vista fija. Existe porque
// una referencia de canto/perfil viajaba como píxeles sin función: el pointer
// genérico ("reproduce its printed image") solo ancla el arte impreso y el
// modelo ignoraba justo lo que esa vista fija (grosor, marco, acabado).
// '' si ninguna imagen presente tiene uso declarado; empieza con espacio
// (concatenable, mismo contrato que describeProductScale). La usan el compiler
// FLUX (panel fresco) y los pointers de chat (regenerar/refinar).
export function productUsageClause(
  paths: string[],
  usages?: Record<string, string>,
): string {
  const described = paths
    .map((p) => usages?.[p]?.trim())
    .filter((u): u is string => !!u);
  if (described.length === 0) return '';
  return ` The attached product reference images include: ${described.join('; ')}. Match exactly the construction each view shows — edge thickness, frame, finish and proportions — not just the printed artwork.`;
}

// Peso físico → interacción (spec 2026-07-02). EN, para compilers de imagen y
// video (donde "lo mueve como si no pesara" más se nota). '' sin dato o <2kg;
// empieza con espacio (concatenable, mismo contrato que describeProductScale).
export function describeProductWeight(product?: ProductInventory): string {
  const kg = product?.weightKg;
  if (!kg || kg < 2) return '';
  const interaction =
    kg < 10
      ? 'When a person lifts, carries or hands it over, they use a firm two-handed grip and their posture shows its clear heft; it is never tossed or waved around like a light prop.'
      : kg < 30
        ? 'Lifting or moving it takes visible effort — two hands, braced posture, slow deliberate movement; a person never swings it or handles it casually.'
        : 'It is too heavy for one person to carry casually: moving it means dragging it, tilting it carefully, or two people lifting together; a single person never lifts it with ease.';
  return ` The product weighs about ${kg} kg. ${interaction}`;
}

// Datos físicos mínimos del producto para los SYSTEM prompts de AUTORÍA de
// escenas (matcher y asistente de refinado) — en español, porque esos SYSTEM
// son en español. Independiente de ProductInventory: el planner no maneja
// paths de imágenes.
export type PlannerProductFacts = {
  name?: string;
  category?: string;
  medium?: string;
  heightCm?: number;
  widthCm?: number;
  weightKg?: number;
};

// Bloque de staging proporcional + peso para el planner (spec 2026-07-02).
// Preferencia con excepción (decisión del usuario): default no-en-manos con
// colocación natural POR TIPO (ejemplos ilustrativos, no lista cerrada);
// cargar/entregar se permite si la idea lo pide explícito. '' sin datos.
export function stagingPlannerBlock(product?: PlannerProductFacts): string {
  if (!product) return '';
  const parts: string[] = [];
  // Dimensión DOMINANTE (max de alto/ancho): mismo criterio que describeProductScale
  // (Fix 2026-07-02) — un panel ancho-y-bajo es grande por su ancho.
  const size = Math.max(product.heightCm ?? 0, product.widthCm ?? 0);
  const ratio = size > 0 ? size / ADULT_REF_CM : 0;
  if (size > 0 && ratio >= 0.45) {
    const dims =
      product.heightCm && product.widthCm
        ? `${product.heightCm}x${product.widthCm} cm`
        : `${size} cm`;
    const tipo = [product.medium, product.category].filter(Boolean).join(' / ');
    parts.push(
      `\nSTAGING PROPORCIONAL: el producto${tipo ? ` (${tipo})` : ''} mide ~${dims} — una pieza GRANDE respecto a una persona. Por defecto NO lo pongas en las manos de nadie: colócalo donde ese tipo de objeto vive o reposa de forma natural en la escena — decide según qué es el producto (un cuadro cuelga de la pared o va sobre un soporte; una lámpara de pie va al suelo; un mueble se asienta en el piso; una tabla se recarga) — con las personas AL LADO, y describe un plano suficientemente abierto para que la pieza completa se vea proporcional junto a ellas y quepa entera en el encuadre. Excepción: si la idea pide explícitamente cargarlo, moverlo o entregarlo, se permite — descríbelo a dos brazos y con la pieza cubriendo gran parte del cuerpo, nunca como objeto pequeño de mano.`,
    );
  }
  const kg = product.weightKg;
  if (kg && kg >= 2) {
    const esfuerzo =
      kg < 10
        ? 'con agarre firme a dos manos y el peso evidente en la postura'
        : kg < 30
          ? 'con esfuerzo visible: dos manos, postura firme, movimiento lento y cuidadoso'
          : 'sin cargarlo de forma casual: se arrastra, se inclina con cuidado o lo mueven dos personas';
    parts.push(
      `\nPESO DEL PRODUCTO: pesa ~${kg} kg. Cuando un personaje lo mueva, cargue o entregue, descríbelo ${esfuerzo}; nunca lo maneja como si no pesara, salvo que la idea pida explícitamente romper la física.`,
    );
  }
  return parts.join('');
}

// Ficha COMPACTA para clips multi-producto (spec 2026-07-15): N fichas
// completas de describeProduct saturarían el prompt. Solo hechos declarados +
// un ancla de fidelidad corta; el arbitraje largo y el staging proporcional
// son de clips single-producto.
// Los productos se identifican por ORDINAL ("Product 1 of 4"), NUNCA por su
// nombre: Seedance renderiza como texto en pantalla las palabras que lee, y
// los nombres propios enumerados salían escritos sobre los cuadros (bug
// observado en Anuncio #15 clips 11-12). El single-path nunca incluyó el
// nombre (describeProduct con medium lo omite) — este es su espejo.
export function describeProductCompact(product: ProductInventory, index: number, total: number): string {
  const parts: string[] = [
    product.medium ? `Product ${index + 1} of ${total}: a ${product.medium}` : `Product ${index + 1} of ${total}`,
  ];
  if (product.visualDetails) {
    parts.push(product.medium ? `displaying this printed image: ${product.visualDetails}` : product.visualDetails);
  }
  if (product.palette?.length) parts.push(`colors ${product.palette.join(', ')}`);
  if (product.heightCm && product.widthCm) parts.push(`about ${product.heightCm} cm tall and ${product.widthCm} cm wide`);
  else if (product.heightCm) parts.push(`about ${product.heightCm} cm tall`);
  else if (product.widthCm) parts.push(`about ${product.widthCm} cm wide`);
  return `${parts.join(', ')}. It must appear exactly as in its reference images — never restyle, stretch or recolor it.`;
}

// Mitigación anti-conteo (la razón por la que multi-producto se excluyó en el
// spec V3 y se revierte en el de 2026-07-15): Seedance tiende a duplicar o
// fusionar productos en tomas con varios. Conteo exacto SIN nombres (mismo
// motivo anti-texto que describeProductCompact); las fichas ordinales aportan
// la distinción.
export function multiProductCountClause(count: number): string {
  return (
    `The scene contains exactly ${count} distinct products — ` +
    `render each product exactly once, at its true relative size; ` +
    `do not duplicate, merge or invent additional products.`
  );
}
