// Inferencia pura de producto asignado a un clip, basada en texto descriptivo.
//
// CLAVE: la inferencia depende de que el master (Gemini) nombre los productos
// de forma DISTINTA en cada clip — si nombra el producto por su nombre de
// producto o slug, inferimos el candidato. Si menciona dos o ninguno, la UI
// pide desempate manual.
//
// Lógica: dados candidatos con (id, name, slug, visualDetails), tokenizamos
// el texto del clip y buscamos coincidencias por nombre normalizado, slug o
// palabras significativas del detalle visual. Determinista, sin IO.

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

/**
 * Infiere el producto asignado a un clip basándose en su descripción de texto.
 *
 * Reglas:
 * - Pool vacío: `{ productId: null, confidence: 'none' }`
 * - Exactamente 1 candidato: `{ productId: ese.id, confidence: 'high' }`
 * - Múltiples candidatos:
 *   - Normaliza el texto del clip
 *   - Para cada candidato, verifica si "matchea":
 *     - Su nombre normalizado aparece como substring en el texto normalizado
 *     - Su slug aparece como substring en el texto normalizado
 *     - O ≥2 tokens distintos de su nombre aparecen en el texto normalizado
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

  const matches = pool.filter((candidate) => candidateMatches(candidate, normalizedClip));

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
 * Verifica si un candidato matchea con el texto normalizado.
 *
 * Matchea si:
 * - Su nombre normalizado aparece como substring en el texto
 * - Su slug aparece como substring en el texto
 * - O ≥2 tokens distintos de su nombre aparecen en el texto
 */
function candidateMatches(candidate: ProductCandidate, normalizedClip: string): boolean {
  const normalizedName = normalizeText(candidate.name);

  // Regla 1: nombre normalizado como substring
  if (normalizedClip.includes(normalizedName)) {
    return true;
  }

  // Regla 2: slug como substring
  if (candidate.slug && normalizedClip.includes(candidate.slug)) {
    return true;
  }

  // Regla 3: ≥2 tokens distintos del nombre
  const nameTokens = normalizedName.split(/\s+/).filter((t) => t.length > 0);
  if (nameTokens.length >= 2) {
    const distinctTokensFound = nameTokens.filter((token) => normalizedClip.includes(token)).length;
    if (distinctTokensFound >= 2) {
      return true;
    }
  }

  return false;
}
