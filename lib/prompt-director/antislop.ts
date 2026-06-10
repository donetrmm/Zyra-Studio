// Lista antislop (specs/v2/02 tarea 7): términos vacíos que degradan prompts.
// Fuentes: análisis de motores de prompts publicitarios + guía Uni-1 (nada de
// keyword soup heredada de otras herramientas). Se aplica como paso final de
// TODO compiler.

const BANNED_PHRASES = [
  // adjetivos vacíos
  'breathtaking', 'stunning', 'captivating', 'mesmerizing', 'awe-inspiring',
  'masterfully', 'meticulously', 'exquisitely', 'beautifully crafted',
  'cinematic masterpiece', 'visual feast', 'a symphony of', 'seamlessly',
  'effortlessly', 'flawlessly', 'cutting-edge', 'state-of-the-art',
  'next-level', 'rich tapestry', 'vibrant tapestry', 'kaleidoscope of',
  'a testament to', 'speaks volumes', 'resonates deeply', 'game-changer',
  'revolutionary', 'groundbreaking',
  // keyword soup de otras herramientas
  '8k', '4k ultra', 'ultra detailed', 'ultra-detailed', 'highly detailed',
  'masterpiece', 'best quality', 'trending on artstation', 'award-winning',
  'award winning',
] as const;

// Frases con regex propio (límites de palabra, case-insensitive).
const BANNED_REGEXES = BANNED_PHRASES.map(
  (p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
);

export function stripSlop(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  let out = text;
  for (let i = 0; i < BANNED_REGEXES.length; i++) {
    const re = BANNED_REGEXES[i];
    if (re.test(out)) {
      removed.push(BANNED_PHRASES[i]);
      out = out.replace(re, '');
    }
    re.lastIndex = 0;
  }
  if (removed.length === 0) return { text, removed };
  // Limpiar restos: comas/espacios huérfanos dejados por las eliminaciones.
  out = out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/,\s*([,.;])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/(^|[.;:]\s*),/g, '$1')
    .trim();
  return { text: out, removed };
}
