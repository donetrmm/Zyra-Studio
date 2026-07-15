// Inferencia pura de producto asignado a un clip, basada en texto descriptivo.
//
// CLAVE: la inferencia depende de que el master (Gemini) nombre los productos
// de forma DISTINTA en cada clip — si nombra el producto por su nombre de
// producto, slug o detalle visual, inferimos el candidato. Si menciona dos o
// ninguno, la UI pide desempate manual.
//
// Lógica: dados candidatos con (id, name, slug, visualDetails), tokenizamos
// el texto del clip en PALABRAS completas (no substrings crudos) y buscamos:
//   (a) el nombre completo como frase con bordes de palabra, o
//   (b) ≥2 tokens significativos (>3 chars, de name+slug+visualDetails)
//       presentes como palabra completa en el clip.
// Esto evita falsos positivos como "arte" dentro de "cuartel", o contar
// stopwords ("de", "la") como si fueran señal de match. Determinista, sin IO.

import { normalizeText } from './text-normalize';

export type ProductCandidate = {
  id: string;
  name: string;
  slug: string | null;
  visualDetails: string | null;
};

export type InferResult = {
  productId: string | null;
  confidence: 'high' | 'low' | 'none';
};

export type InferProductsResult = { productIds: string[]; confidence: 'high' | 'none' };

// Separador de palabras: cualquier corrida de caracteres que no sean letra o
// número (Unicode-aware; normalizeText ya quitó diacríticos, pero el texto
// puede seguir teniendo ñ, guiones, puntuación, etc.).
const WORD_SPLIT_REGEX = /[^\p{L}\p{N}]+/u;

// Umbral de longitud para considerar un token "significativo" (descarta
// stopwords cortas como "de", "la", "el", "y").
const MIN_SIGNIFICANT_TOKEN_LENGTH = 3;

function tokenize(text: string): string[] {
  return text.split(WORD_SPLIT_REGEX).filter((t) => t.length > 0);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Verifica que `phrase` aparezca en `haystack` como frase completa, con
 * bordes de palabra (no como substring embebido en otra palabra).
 */
function containsWholePhrase(haystack: string, phrase: string): boolean {
  if (phrase.length === 0) {
    return false;
  }
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(phrase)}(?:$|[^\\p{L}\\p{N}])`, 'u');
  return pattern.test(haystack);
}

/**
 * Tokens significativos (>3 chars) de name + slug + visualDetails,
 * deduplicados. Sirven como señal de match cuando el nombre completo no
 * aparece literal en el clip, pero varias palabras propias del producto sí.
 */
function significantTokens(candidate: ProductCandidate): Set<string> {
  const tokens = new Set<string>();
  const addFrom = (text: string | null) => {
    if (!text) return;
    for (const token of tokenize(normalizeText(text))) {
      if (token.length > MIN_SIGNIFICANT_TOKEN_LENGTH) {
        tokens.add(token);
      }
    }
  };
  addFrom(candidate.name);
  addFrom(candidate.slug);
  addFrom(candidate.visualDetails);
  return tokens;
}

/**
 * Infiere el producto asignado a un clip basándose en su descripción de texto.
 *
 * Reglas:
 * - Pool vacío: `{ productId: null, confidence: 'none' }`
 * - Exactamente 1 candidato: `{ productId: ese.id, confidence: 'high' }`
 * - Múltiples candidatos:
 *   - Normaliza y tokeniza el texto del clip
 *   - Para cada candidato, verifica si "matchea" (ver `candidateMatches`)
 *   - Si exactamente 1 matchea: `{ productId: ese.id, confidence: 'high' }`
 *   - Si ninguno matchea: `{ productId: null, confidence: 'none' }`
 *   - Si ≥2 matchean (ambiguo): `{ productId: null, confidence: 'low' }`
 */
export function inferProductForClip(clipText: string, pool: ProductCandidate[]): InferResult {
  // Pool vacío
  if (pool.length === 0) {
    return { productId: null, confidence: 'none' };
  }

  // Exactamente 1 candidato
  if (pool.length === 1) {
    return { productId: pool[0].id, confidence: 'high' };
  }

  // Múltiples candidatos: buscar matches
  const normalizedClip = normalizeText(clipText);
  const clipTokens = new Set(tokenize(normalizedClip));

  const matches = pool.filter((candidate) => candidateMatches(candidate, normalizedClip, clipTokens));

  if (matches.length === 0) {
    return { productId: null, confidence: 'none' };
  }

  if (matches.length === 1) {
    return { productId: matches[0].id, confidence: 'high' };
  }

  // ≥2 candidatos matchean: ambiguo
  return { productId: null, confidence: 'low' };
}

/**
 * Verifica si un candidato matchea con el clip. Matchea si:
 * - (a) su nombre normalizado aparece completo, como frase con bordes de
 *   palabra (no embebido dentro de otra palabra), o
 * - (b) ≥2 de sus tokens significativos (name+slug+visualDetails, >3 chars)
 *   aparecen como palabra completa en el clip.
 */
function candidateMatches(
  candidate: ProductCandidate,
  normalizedClip: string,
  clipTokens: Set<string>,
): boolean {
  const normalizedName = normalizeText(candidate.name);

  // Regla (a): nombre completo como frase con bordes de palabra
  if (containsWholePhrase(normalizedClip, normalizedName)) {
    return true;
  }

  // Regla (b): ≥2 tokens significativos presentes como palabra completa
  let significantMatchCount = 0;
  for (const token of significantTokens(candidate)) {
    if (clipTokens.has(token)) {
      significantMatchCount += 1;
      if (significantMatchCount >= 2) {
        return true;
      }
    }
  }

  return false;
}

// Frase colectiva ("todos los productos", "toda la colección"): asigna el pool
// completo. El texto ya viene por normalizeText (minúsculas, sin diacríticos).
const COLLECTIVE_RE =
  /\btod(?:o|a|os|as)\s+(?:el\s+|la\s+|los\s+|las\s+|nuestros\s+|nuestras\s+|sus\s+)?(?:productos|cuadros|piezas|lienzos|coleccion|linea|catalogo|obras)\b|\b(?:coleccion|linea)\s+completa\b|\bcatalogo\s+completo\b/;

// Numeral + sustantivo genérico de producto ("los tres cuadros"): si el número
// coincide con el tamaño del pool, es el pool completo.
const NUMERAL_RE = /\b(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|\d+)\s+(?:productos|cuadros|piezas|lienzos|obras)\b/;
const NUMBER_WORDS: Record<string, number> = {
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
};

/**
 * Inferencia MULTI (spec 2026-07-15): un clip puede llevar varios productos.
 * Nombrar k productos asigna los k (el "ambiguo" del singular desaparece);
 * las frases colectivas y los numerales que calzan con el pool asignan todo.
 */
export function inferProductsForClip(clipText: string, pool: ProductCandidate[]): InferProductsResult {
  if (pool.length === 0) return { productIds: [], confidence: 'none' };
  if (pool.length === 1) return { productIds: [pool[0].id], confidence: 'high' };

  const normalizedClip = normalizeText(clipText);
  if (COLLECTIVE_RE.test(normalizedClip)) {
    return { productIds: pool.map((p) => p.id), confidence: 'high' };
  }
  const numeral = NUMERAL_RE.exec(normalizedClip);
  if (numeral) {
    const n = NUMBER_WORDS[numeral[1]] ?? parseInt(numeral[1], 10);
    if (n === pool.length) return { productIds: pool.map((p) => p.id), confidence: 'high' };
  }

  const clipTokens = new Set(tokenize(normalizedClip));
  const matches = pool.filter((candidate) => candidateMatches(candidate, normalizedClip, clipTokens));
  if (matches.length === 0) return { productIds: [], confidence: 'none' };
  return { productIds: matches.map((m) => m.id), confidence: 'high' };
}
