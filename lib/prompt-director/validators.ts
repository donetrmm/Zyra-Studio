// Validador de producibilidad (specs/v2/02 tarea 6). Cada regla evita una
// regeneración pagada. errors = bloqueo (irrecuperable sin acción del usuario);
// warnings = se genera igual pero se reporta en campaign_items.warnings.

import { findClaims, findAgeWords } from './inventory';
import { resolveRequiredRefs } from './format-director';
import { findUnexpandedActions } from './acting';
import type { CompileRequest, DirectorContext } from './types';

export type ValidationResult = { errors: string[]; warnings: string[] };

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

  return { errors, warnings };
}
