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
export function describeProduct(product: ProductInventory): string {
  const parts = [`Product: ${product.name}`];
  if (product.visualDetails) parts.push(product.visualDetails);
  if (product.palette?.length) parts.push(`brand colors ${product.palette.join(', ')}`);
  return `${parts.join(', ')}. The product must appear exactly as shown in its reference images — same packaging, colors, logo placement and proportions. Never restyle the product.`;
}

// Descripción de personaje age-blind, por apariencia y manera de actuar.
export function describeCharacter(character: CharacterInventory): {
  text: string;
  ageWordsRemoved: string[];
} {
  const { text, removed } = stripAgeWords(character.description);
  return {
    text: `${character.name}: ${text}. Exact appearance as in the character reference image — same face, same hair, same build.`,
    ageWordsRemoved: removed,
  };
}
