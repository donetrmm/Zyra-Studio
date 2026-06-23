// lib/prompt-director/acting.ts
// Dirección de actuación física (tanda P0; principios P14/P20/P21 del análisis
// Higgsfield, ver docs/Generación de videos con IA/hallazgos-higgsfield-completo.md).
// Capa OFICIO determinista: directivas de restraint conscientes del registro que
// se inyectan en los compilers de video, más el detector de actuación sin desglosar
// que consume validators.ts. No llama a ninguna API; mismo input -> mismo output.

import type { DirectorContext } from './types';

// Directiva base de actuación contenida (P20): micro-expresiones, sin sobreactuar.
// Calcada del patrón register-aware de cinematographyDefault/audioDirection.
export const ACTING_RESTRAINT_DIRECTION =
  'Acting: grounded, restrained performance — micro-expressions, precise eye-line, natural breathing and small involuntary movements. The actor reacts and listens; no mugging, no exaggerated faces, no theatrical gestures. Emotion shows in small sequential beats, never several signals at once.';

// Variante para registros enérgicos (bold/kinetic/dance): energía controlada, sin
// sobreactuar. Mismo eje "creíble, no histriónico" que la base.
export const ACTING_ENERGETIC_DIRECTION =
  'Acting: confident, energetic physical performance — still controlled and believable, never mugging or over-the-top; the body carries the energy through clean, intentional movement.';

// Registros que piden energía física (mismo criterio que audioDirection #2 en
// compilers/seedance.ts).
const ENERGETIC_REGISTER_RE = /beat|r[ií]tmic|kinet|en[eé]rg|bold|dance|drop|speed ?ramp/i;

// ¿El guion declara una emoción grande (grito/llanto/furia/pánico)? Cuando la hay,
// NO se inyecta restraint: dejamos pasar la emoción declarada sin contenerla.
const HIGH_EMOTION_RE =
  /\b(scream|shout|sob|cry|cries|crying|weep|wail|rage|furious|terrified|panic|grito|gritar|llant|llora|sollo|furi|aterr|p[aá]nico)\w*/i;

export function declaresHighEmotion(text: string): boolean {
  return HIGH_EMOTION_RE.test(text);
}

// Directiva de actuación adecuada al registro y la emoción declarada, o null
// cuando no debe inyectarse (emoción alta declarada).
export function actingDirectionFor(register: string, highEmotion: boolean): string | null {
  if (highEmotion) return null;
  return ENERGETIC_REGISTER_RE.test(register)
    ? ACTING_ENERGETIC_DIRECTION
    : ACTING_RESTRAINT_DIRECTION;
}

// ¿Hay un rostro intencional en el clip? (personaje del Cast con hoja maestra, o
// hablante en cámara). Misma condición que el guard NO_REAL_FACES_CLAUSE de Seedance.
export function facesIntended(ctx: DirectorContext, speaker: boolean): boolean {
  return speaker || (ctx.characters ?? []).some((c) => !!c.masterImagePath);
}
