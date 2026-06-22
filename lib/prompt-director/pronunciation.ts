// Respelling de pronunciación para el habla de Seedance. El modelo mastica ciertas
// palabras españolas (típicamente verbos PAROXÍTONOS sin tilde: la tónica va en la
// penúltima sílaba pero el modelo la coloca mal). Marcar la tónica explícitamente lo
// corrige — validado a mano por el usuario ("imprimíste", "regaládo").
//
// Por qué un mapa CURADO y no una regla general: no se puede predecir qué palabra
// fallará sin probarla, y acentuar todas las paroxítonas (la mayoría del español)
// sobre-aplica y puede ROMPER palabras que ya salen bien. El mapa solo toca palabras
// confirmadas; se extiende en una línea cuando aparezca otra que falle.
//
// Solo afecta el PROMPT enviado al modelo (no el scene_prompt guardado): se aplica al
// compilar el video. Las palabras son español; el texto en inglés del prompt no matchea.
export const PRONUNCIATION_RESPELLINGS: Record<string, string> = {
  imprimiste: 'imprimíste',
  regalado: 'regaládo',
};

// Capitaliza la primera letra si el match original venía capitalizado.
function matchCase(original: string, replacement: string): string {
  if (original[0] === original[0]?.toUpperCase() && original[0] !== original[0]?.toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

// Reemplaza las palabras conocidas por su respelling con la tónica marcada. Whole-word
// (\b), case-insensitive, preserva la mayúscula inicial. Determinista e idempotente
// (la forma con tilde no vuelve a matchear la clave sin tilde). No-op si no hay coincidencias.
export function applyRespellings(text: string, map: Record<string, string> = PRONUNCIATION_RESPELLINGS): string {
  let out = text ?? '';
  for (const [word, respelled] of Object.entries(map)) {
    const re = new RegExp(`\\b${word}\\b`, 'gi');
    out = out.replace(re, (m) => matchCase(m, respelled));
  }
  return out;
}
