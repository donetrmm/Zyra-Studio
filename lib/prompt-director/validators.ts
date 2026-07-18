// Validador de producibilidad (specs/v2/02 tarea 6). Cada regla evita una
// regeneración pagada. errors = bloqueo (irrecuperable sin acción del usuario);
// warnings = se genera igual pero se reporta en campaign_items.warnings.

import { findClaims, findAgeWords } from './inventory';
import { resolveRequiredRefs } from './format-director';
import { findUnexpandedActions, findOvermechanicalActions } from './acting';
import { hasSpatialBlocking } from './spatial';
import type { CompileRequest, DirectorContext } from './types';

export type ValidationResult = { errors: string[]; warnings: string[] };

// Tipos de plano reconocidos (en/es): un tramo dirigido nombra un plano o un
// movimiento de cámara. Su ausencia en un tramo multi-beat = actuación sin encuadre.
const SHOT_RE =
  /\b(wide|medium|close[- ]?up|extreme close[- ]?up|ecu|over[- ]the[- ]shoulder|ots|pov|establishing|two[- ]shot|insert|macro|aerial|plano (general|medio|cerrado|americano)|primer plano)\b/i;

// Movimientos de cámara reconocidos (en/es). Más de 2 distintos en una toma
// = instrucciones contradictorias.
const CAMERA_MOVES: Array<{ re: RegExp; label: string }> = [
  { re: /\bdolly[- ]?(in|out)?\b/gi, label: 'dolly' },
  { re: /\borbit|órbita|orbita\b/gi, label: 'orbit' },
  { re: /\btracking\b/gi, label: 'tracking' },
  { re: /\bpan(ning|eo)?\b/gi, label: 'pan' },
  { re: /\btilt\b/gi, label: 'tilt' },
  { re: /\bcrane|grúa\b/gi, label: 'crane' },
  { re: /\bwhip[- ]?pan\b/gi, label: 'whip pan' },
  { re: /\bzoom\b/gi, label: 'zoom' },
  { re: /\bpush[- ]?in\b/gi, label: 'push-in' },
  { re: /\bpull[- ]?back\b/gi, label: 'pull-back' },
];

// Señales de texto en pantalla: va en post o en imagen, nunca generado en video.
const ONSCREEN_TEXT_RE =
  /\btext overlay\b|\bon-?screen text\b|\bcaptions?\b|\bsubt[ií]tul|\bsubtitles?\b|\btitle card\b|\bwords appear\b|\btexto en pantalla\b|\bletrero\b|\blower[- ]third\b/gi;

// 3+ sujetos degradan la generación (la atención se reparte).
const MULTI_SUBJECT_RE =
  /\b(three|four|five|six|tres|cuatro|cinco|seis|3|4|5|6)\s+(people|persons?|friends|men|women|personas|amigos|amigas|hombres|mujeres)\b|\bcrowd\b|\bmultitud\b|\bgroup of (people|friends)\b|\bgrupo de (personas|amigos)\b/gi;

// Ritmo incoherente: acción frenética + cámara/tempo lento (o viceversa).
const SLOW_RE = /\bslow[- ]?(motion|ly)?\b|\bcalm\b|\bpausado\b|\blento\b|\bgentle\b/gi;
const FAST_RE = /\bfrenetic\b|\bfast cuts\b|\brapid\b|\bfrenético\b|\bvertiginoso\b|\bhigh[- ]energy\b|\bspeed ramp\b/gi;

// Cuenta ACCIONES, no frases: las semillas encadenan beats con comas dentro de
// una sola frase ("holds…, tilts…, takes a sip"), que contaban como 1 y evadían
// la regla "1 idea ≈ 4s". Si hay timeline ("0-3s: … 3-7s: …") cuenta sus tramos.
function countActions(text: string): number {
  const timeline = text.match(/\b\d{1,2}\s*[-–]\s*\d{1,2}\s*s\b/gi);
  if (timeline?.length) return timeline.length;
  return Math.max(
    1,
    text
      .split(/[.;,!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3).length,
  );
}

function matchedLabels(text: string): string[] {
  const found = new Set<string>();
  for (const { re, label } of CAMERA_MOVES) {
    if (re.test(text)) found.add(label);
    re.lastIndex = 0;
  }
  return [...found];
}

export function validate(req: CompileRequest, ctx: DirectorContext): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prompt = req.scenePrompt?.trim() ?? '';

  // 0. Básicos (bloqueo)
  if (!prompt) {
    errors.push('scene_prompt vacío');
    return { errors, warnings };
  }
  if (req.durationS !== undefined && (req.durationS < 4 || req.durationS > 15)) {
    errors.push(`duración ${req.durationS}s fuera del rango 4-15 de Seedance`);
  }

  // 1. Referencias obligatorias del formato (bloqueo)
  if (ctx.format) {
    const { missing } = resolveRequiredRefs(ctx.format, ctx);
    errors.push(...missing);
  }

  // 2. Complejidad ∝ duración: 1 idea ≈ 4 s
  const duration = req.durationS ?? ctx.format?.defaultDurationS ?? 8;
  const actions = countActions(prompt);
  const maxIdeas = Math.max(1, Math.floor(duration / 4));
  if (actions > maxIdeas + 1) {
    warnings.push(
      `complejidad: ~${actions} acciones para ${duration}s (1 idea ≈ 4s); considera dividir en más de un item`,
    );
  }

  // 3. Una sola dirección de cámara
  const moves = matchedLabels(prompt);
  if (moves.length > 2) {
    warnings.push(`cámara: ${moves.length} movimientos distintos (${moves.join(', ')}); deja uno principal`);
  }

  // 3b. Cámara por tramo (P21): 2+ movimientos en el MISMO tramo del timeline son
  // contradictorios (la regla del matcher pide uno por tramo). Más preciso que el
  // conteo global de arriba, que es legítimo a lo largo de varios tramos.
  const tramos = prompt
    .split(/(?=\b\d{1,2}\s*[-–]\s*\d{1,2}\s*s\s*:)/)
    .filter((t) => /\b\d{1,2}\s*[-–]\s*\d{1,2}\s*s/.test(t));
  for (const tramo of tramos) {
    const tramoMoves = matchedLabels(tramo);
    if (tramoMoves.length > 1) {
      const label = tramo.match(/\d{1,2}\s*[-–]\s*\d{1,2}\s*s/)?.[0] ?? 'tramo';
      warnings.push(
        `cámara: el tramo '${label}' tiene ${tramoMoves.length} movimientos (${tramoMoves.join(', ')}); deja uno`,
      );
    }
  }

  // 4. Identidad anclada: si el prompt habla de una persona, debe haber Cast
  const mentionsPerson =
    /\b(person|creator|presenter|man|woman|persona|creador|creadora|presentador|presentadora|modelo)\b/i.test(prompt);
  const hasCast = (ctx.characters ?? []).some((c) => c.masterImagePath);
  if (mentionsPerson && !hasCast) {
    warnings.push(
      'identidad: el prompt menciona una persona sin referencia del Cast; la cara cambiará entre generaciones',
    );
  }

  // 5. 3+ sujetos
  if (MULTI_SUBJECT_RE.test(prompt)) {
    warnings.push('sujetos: 3+ personas degradan la generación; genera por separado y monta');
  }
  MULTI_SUBJECT_RE.lastIndex = 0;

  // 6. Texto en pantalla pedido explícitamente
  if (ONSCREEN_TEXT_RE.test(prompt)) {
    warnings.push(
      'texto en pantalla: el video no debe renderizar texto; va en el caption del export o en imagen estática (el compiler agrega la cláusula negativa)',
    );
  }
  ONSCREEN_TEXT_RE.lastIndex = 0;

  // 7. Claims fabricados
  const claims = findClaims(prompt);
  if (claims.length) {
    warnings.push(`claims no verificables en el prompt: ${claims.join(', ')}; describe solo lo visible y audible`);
  }

  // 8. Marcadores de edad
  const ageWords = findAgeWords(prompt);
  if (ageWords.length) {
    warnings.push(`edad: evita marcadores (${ageWords.join(', ')}); describe por apariencia y vestuario`);
  }

  // 9. Coherencia de ritmo
  const hasSlow = SLOW_RE.test(prompt);
  SLOW_RE.lastIndex = 0;
  const hasFast = FAST_RE.test(prompt);
  FAST_RE.lastIndex = 0;
  if (hasSlow && hasFast) {
    warnings.push('ritmo: el prompt mezcla tempo lento y frenético; alinea acción, cámara y música');
  }

  // 10. Actuación sin desglosar (P14): verbos abstractos sin micro-acciones.
  const unexpanded = findUnexpandedActions(prompt);
  if (unexpanded.length) {
    warnings.push(
      `actuación: ${unexpanded.join(', ')} sin micro-acciones observables; desglosa en gestos secuenciales (asiente, gira el hombro, chasquea)`,
    );
  }

  // 11. Sobre-mecánica (P14b): acción descrita por biomecánica articular en vez
  // de intención + resultado. La directiva del matcher debería evitarlo; esto es
  // la red de seguridad si se cuela. No bloquea, no reescribe.
  const overmechanical = findOvermechanicalActions(prompt);
  if (overmechanical.length) {
    warnings.push(
      `actuación: sobre-mecánica (${overmechanical.join(', ')}); descríbela por intención y resultado, no por la mecánica articular`,
    );
  }

  // 12. Estructura por tramo (P12): en un timeline de 2+ tramos, cada tramo
  // debería abrir con un plano o un movimiento de cámara. Un tramo sin ninguno
  // deja la actuación sin encuadre. Warning, no bloqueo (el compiler ya inyecta
  // cinematographyDefault); usa el mismo split por tramos de la regla 3b.
  // Solo aplica a timelines multi-beat (2+ tramos): un único tramo no es un
  // timeline dirigido, así que no debe disparar un warning espurio.
  if (tramos.length >= 2) {
    for (const tramo of tramos) {
      const hasShot = SHOT_RE.test(tramo);
      const hasMove = matchedLabels(tramo).length > 0;
      if (!hasShot && !hasMove) {
        const label = tramo.match(/\d{1,2}\s*[-–]\s*\d{1,2}\s*s/)?.[0] ?? 'tramo';
        warnings.push(
          `cámara: tramo '${label}' sin plano ni movimiento; nómbralo (wide/medium/close-up, dolly/pan...)`,
        );
      }
    }
  }

  // 13. Vista única del producto (P01): con una sola imagen de referencia, I2V/R2V
  // deriva la geometría del producto (no tiene estructura 3D que anclar). Warning ->
  // el usuario genera un 3/4 en el Brand Kit (botón en BrandKitsPage).
  if (ctx.products?.length === 1 && ctx.products[0].imagePaths?.length === 1) {
    warnings.push(
      'producto: vista única — riesgo de deriva geométrica en I2V/R2V; genera un 3/4 en el Brand Kit',
    );
  }

  // 14. Bloqueo geo-espacial (P13): una escena con 2+ sujetos sin marcadores de
  // posición/orientación deja al modelo libre de reubicarlos entre cortes. El
  // SYSTEM del matcher debería emitir el bloqueo; esto es la red de seguridad.
  const multiSubject = (ctx.characters?.length ?? 0) >= 2 || MULTI_SUBJECT_RE.test(prompt);
  MULTI_SUBJECT_RE.lastIndex = 0;
  if (multiSubject && !hasSpatialBlocking(prompt)) {
    warnings.push(
      'espacial: escena con 2+ sujetos sin bloqueo (posición relativa/orientación); el modelo puede reubicarlos entre cortes',
    );
  }

  return { errors, warnings };
}
