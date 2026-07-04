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

// Expresión contenida para el PANEL fresco del storyboard (feedback 2026-07-04:
// "las expresiones se ven poco naturales y exageradas"). La sonrisa-de-anuncio
// nace en la imagen y el video la hereda (el panel viaja como first-frame /
// referencia), así que el freno se aplica en el origen visual. Subordinada a la
// fidelidad, como humanRealismDirective: dirige la INTENSIDAD de la expresión,
// nunca re-renderiza identidad. Empieza con espacio (concatenable).
export const NATURAL_EXPRESSION_CLAUSE =
  ' Facial expressions and body language stay natural and understated: relaxed faces, small honest gestures, the candid ease of people who do not know they are being photographed — never wide forced advertising smiles, never theatrical poses or exaggerated emotion. Keep everyone\'s exact identity, face and body from the reference images; only the intensity of the expression is directed here.';

// Bloque en español para el SYSTEM del matcher/planner (patrón de
// PLANNER_PHYSICS_BLOCK): las emociones nacen contenidas en el scenePrompt.
// Si el planner escribe "ríe a carcajadas", ninguna cláusula del compiler lo
// contiene después — el guion manda. Empieza con \n.
export const PLANNER_ACTING_BLOCK =
  '\nACTUACIÓN Y EXPRESIONES: escribe las emociones como gestos pequeños y observables, en secuencia (una sonrisa leve, una mirada que baja, una exhalación) — nunca muecas grandes ni poses teatrales ("enorme sonrisa", "ríe a carcajadas", "cara de asombro"), salvo que la idea pida esa emoción explícitamente. Las personas actúan con la naturalidad de quien no sabe que lo filman.';

// Registros que piden energía física (mismo criterio compartido con audioDirection en
// compilers/seedance.ts — UN solo regex para que no diverjan). Cubre vocabulario en
// inglés y español; \b en los tokens cortos (bold/drop/beat/dance) evita falsos
// positivos por subcadena (backdrop, emboldened, heartbeat, abundance).
export const ENERGETIC_REGISTER_RE =
  /\bbeat\b|r[ií]tmic|kinet|en[eé]rg|\bbold\b|\bdance\b|\bdrop\b|speed ?ramp|alegr|festiv|fiesta|celebra|din[áa]mic|vibra|\bupbeat\b|j[úu]bil|euf[óo]r/i;

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

// Detector P14: verbos de acción/emoción abstractos que NO traen micro-acciones
// observables cerca. Heurística -> validators emite warning (no bloquea, no reescribe).
const ABSTRACT_ACTION_RE =
  /\b(dances?|dancing|celebrat\w*|part(?:y|ies|ying)|works? out|working out|exercis\w*|relax\w*|hangs? out|fights?|fighting|(?:looks?|is|are|seems?)\s+(?:sad|happy|excited|angry|scared|nervous|emotional))\b/gi;

const CONCRETE_ACTION_RE =
  /\b(nods?|nodding|head|shoulders?|hips?|knees?|steps?|stepping|sway\w*|hands?|fingers?|snaps?|snapping|claps?|clapping|leans?|leaning|turns?|turning|tilts?|tilting|jaw|eyes?|blinks?|blinking|breath\w*|swallows?|swallowing|grins?|grinning|brow|twist\w*|bounc\w*|raises?|raising|lifts?|lifting|points?|pointing|reaches?|reaching|taps?|tapping)\b/i;

// Parte en oraciones/tramos y, por cada verbo abstracto, comprueba si su tramo tiene
// algún token concreto. Devuelve los verbos abstractos sin desglosar (en minúsculas).
export function findUnexpandedActions(text: string): string[] {
  const segments = text.split(/(?<=[.;])\s+|\b\d{1,2}\s*[-–]\s*\d{1,2}\s*s\s*:/);
  const flagged = new Set<string>();
  for (const seg of segments) {
    if (CONCRETE_ACTION_RE.test(seg)) continue;
    const matches = seg.match(ABSTRACT_ACTION_RE);
    if (matches) for (const m of matches) flagged.add(m.toLowerCase().replace(/\s+/g, ' '));
  }
  return [...flagged];
}

// Detector P14b: sobre-mecánica articular en el scenePrompt. A diferencia de P14
// (que pide DESCOMPONER verbos abstractos en gestos observables), aquí marcamos el
// extremo OPUESTO: mecánica articulación-por-articulación (sentido de rotación,
// grados, mano-estabiliza-mano, articulación/músculo nombrados) que confunde al
// modelo y genera artefactos. El marcador set es DISJUNTO de los gestos buenos de
// P14 (nod/snap/lean/step/knee bend): la presencia de un marcador basta para marcar.
const OVERMECHANICAL_RE =
  /\b(?:counter|anti)?clockwise\b|\b\d{1,3}[- ]?degrees?\b|\bwhile the (?:left|right|other) hand (?:stabiliz|steadi|hold|brac)\w*|\b(?:flex|extend|rotat)\w* the (?:wrist|elbow|knee|shoulder|ankle|hip)\b|\bjoint by joint\b|\bmuscle by muscle\b|\bsentido (?:horario|antihorario)\b|\barticulaci[óo]n\w*/gi;

// Frases de sobre-mecánica halladas (minúsculas, deduplicadas). [] si no hay.
export function findOvermechanicalActions(text: string): string[] {
  const matches = text.match(OVERMECHANICAL_RE);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.toLowerCase().replace(/\s+/g, ' ')))];
}
