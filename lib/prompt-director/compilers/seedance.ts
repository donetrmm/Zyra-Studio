// Compiler de Seedance 2.0 (specs/v2/02 tarea 4): produce el prompt CRAFT
// (Context → Reference → Action → Framing → Timing) con referencias @ en el
// orden exacto en que el handler las firma y envía. Guía completa en
// docs/modelos/06-seedance-2.md.

import { describeCharacter, describeProduct, describeProductWeight } from '../inventory';
import { normalizeSpokenInDialogue } from '../es-mx-normalize';
import { directionFor } from '../format-director';
import { applyRespellings } from '../pronunciation';
import { actingDirectionFor, declaresHighEmotion, facesIntended, ENERGETIC_REGISTER_RE } from '../acting';
import { creativeGuidelineClauses } from '@/lib/campaigns/guidelines';
import { deliveryCueFor, injectDeliveryCue } from '@/lib/campaigns/voice-tone';
import { getStyleProfile, type StyleProfile } from '../style-profiles';
import { SCENE_INTEGRATION_CLAUSE } from '../spatial';
import type {
  CompiledPrompt,
  CompiledReference,
  CompileRequest,
  DirectorContext,
} from '../types';

// Cláusula negativa fija (texto/logo/watermark): SIEMPRE.
// OJO: NO prohibir "logos" a secas — el logo impreso en el empaque del producto
// referenciado es branding legítimo y central del anuncio. Solo se prohíbe que el
// modelo INVENTE/añada logos o tipografía que no estén físicamente en el producto.
// Exportada: los clips de continuación de secuencia (buildContinuationPrompt) la
// re-anclan porque no pasan por el compiler y perdían la protección anti-overlay.
export const NEGATIVE_CLAUSE =
  'No on-screen text overlays, captions, subtitles or watermarks added by the model. Do not invent or add any logo or typography that is not physically part of the referenced product.';

// Guard anti-rostros: SOLO cuando NINGÚN rostro es intencional (clip de puro
// producto/abstracto), para que el modelo no fabrique una persona real espuria.
// Si hay personaje del Cast (cara anclada por referencia) o habla EN cámara
// (lip-sync), el rostro ES el objetivo del clip y prohibir "rostros reales" se
// contradice con la referencia y la dirección de lip-sync → degrada la cara.
// Exportada: la reusan los clips de continuación (buildContinuationPrompt) en
// tomas de puro producto, mismo gate (!facesIntended) que el compiler.
export const NO_REAL_FACES_CLAUSE = 'No real, identifiable human faces.';

// Directiva de beat-sync del audio de referencia. Fuente única: la cita el compiler
// normal (rama @audio1) y la rama R2V del storyboard (buildCastR2VRefs) para que la
// dirección de música sea idéntica en todo el producto. Sin espacio inicial: el
// compiler la usa como línea propia; el storyboard antepone el espacio al concatenar.
export const AUDIO_BEAT_SYNC_CITATION =
  '@audio1 sets the background audio mood and rhythm; sync scene energy to its beats.';

// Voz del hablante (personaje principal del clip): @audio1 como referencia de
// timbre/acento para el diálogo hablado. Misma apuesta que el encadenado prev_clip:
// Seedance usa el audio citado como molde de voz. Comparte el slot @audio1 con la
// música — cuando hay voz, la música se omite (la voz gana). Sin espacio inicial:
// el compiler la usa como línea propia; el storyboard antepone el espacio al concatenar.
// Fase 2 audio (2026-07-13): copia SOLO timbre/grano/acento de la muestra, NO su
// prosodia — el modelo heredaba la entonación plana de la muestra clonada aunque el
// prompt pidiera expresividad. Ahora la entonación/emoción siguen la dirección.
export const VOICE_TIMBRE_CITATION =
  '@audio1 is the voice reference for the speaking character — copy only its vocal timbre, grain and accent for all spoken dialogue in this clip; do NOT copy the reference clip\'s own intonation or pacing. Let the pitch movement, rhythm, emphasis and emotion follow the expressive delivery direction in this prompt, so the voice stays lively and expressive, never flat or monotone. Use it only as a voice model, not as background music.';

// El prompt va en inglés (rinde mejor), pero sin esta directiva el modelo
// genera los diálogos en inglés. Exportada: la reusan las variantes.
// La dirección de voz natural (cadencia, pausas, anti-locutor) viene del
// prompt de ejemplo validado a mano (2026-06-12): sin ella la voz sale
// robótica. OJO: acento mexicano sustituye al "neutral LatAm" original —
// decisión tomada de ese ejemplo que funcionó.
export const DIALOGUE_LANGUAGE: Record<'es' | 'en', string> = {
  es: 'All spoken dialogue and any voice-over must be in Mexican Latin American Spanish (es-MX) with a natural Mexican accent — never a Castilian accent from Spain: pronounce c and z as a soft s (Latin American seseo), never as the Castilian "th" sound, and use Mexican intonation, rhythm and vocabulary. Perform the line with expressive, dynamic vocal delivery: vary pitch and intonation, emphasize the key words, and let real emotion ride through the voice, with a warm conversational tone, subtle pauses and breathing and natural emotional variation — speak as if talking to a friend, never flat, monotone, robotic or announcer-like. Keep this expressiveness in the VOICE; any on-camera restraint applies only to the face and gestures, not to the vocal delivery. Speak the whole line as one continuous, connected thought at a lively, natural conversational pace: do not insert dramatic pauses, dead gaps or hesitations between phrases, and do not slow down or drag the delivery — keep the words flowing smoothly and continuously from start to finish, pausing only where a real person naturally would, at a comma or a full stop. Even while natural, articulate every word completely and correctly: give each syllable of longer or less common words its full value, without slurring, dropping endings or rushing through consonant clusters.',
  en: 'All spoken dialogue and any voice-over must be in English. Perform the line with expressive, dynamic vocal delivery: vary pitch and intonation, emphasize the key words, and let real emotion ride through the voice, with a warm conversational tone, subtle pauses and breathing and natural emotional variation — speak as if talking to a friend, never flat, monotone, robotic or announcer-like. Keep this expressiveness in the VOICE; any on-camera restraint applies only to the face and gestures, not to the vocal delivery. Speak the whole line as one continuous, connected thought at a lively, natural conversational pace: do not insert dramatic pauses, dead gaps or hesitations between phrases, and do not slow down or drag the delivery — keep the words flowing smoothly and continuously from start to finish, pausing only where a real person naturally would, at a comma or a full stop. Even while natural, articulate every word completely and correctly: give each syllable of longer or less common words its full value, without slurring, dropping endings or rushing through consonant clusters.',
};

// Lip sync y habla EN cámara (no narración): solo cuando hay un hablante en
// escena. Del mismo ejemplo validado a mano. Exportada: la reusan los clips de
// continuación de secuencia para no perder el lip-sync a mitad del anuncio.
export const SPEECH_DIRECTION =
  'The on-camera speaker talks directly to the camera: generate synchronized speech with accurate lip sync — natural mouth movements matching every spoken word, facial expressions and jaw timing following the dialogue, with realistic blinking, breathing and subtle head movements. Synchronized on-camera speech, not voice-over narration.';

// Dinamismo del hablante (Fase 2 audio, 2026-07-13): al acortar clips hablados el
// talento salía "parado/tieso" — los frames quietos del storyboard + la animación
// mínima desde un panel estático + el restraint lo congelaban en una foto que habla.
// Esta directiva mantiene el CUERPO vivo (gestos, peso, torso) sin tocar la
// contención de la CARA: explícitamente no-teatral, así convive con
// ACTING_RESTRAINT_DIRECTION sin reactivar el "exagerado" (feedback 2026-07-04).
// Exportada: los clips de continuación la re-anclan (paridad con SPEECH_DIRECTION).
export const SPEAKER_LIVELINESS =
  'Keep the speaker physically alive and dynamic for the whole shot — never a stiff, frozen or posed talking photo. Natural, continuous motion carries the clip: easy hand and arm gestures that follow the speech, small weight shifts, relaxed shoulder and torso movement, gentle head tilts, expressive eyes and eyebrows, natural blinking and breathing. This is the effortless, candid energy of a real person mid-conversation — believable and grounded, never mugging, theatrical or exaggerated.';

// Narración en OFF (voiceover): voz hablada SIN hablante en cámara, sin lip-sync. Para
// tomas de producto/insertos con VO. Sin esto, hasSpokenDialogue (que matchea el
// entrecomillado) hacía que un VO recibiera la dirección de lip-sync on-camera — una
// contradicción ("not voice-over narration") que el modelo resolvía con voz rara/robótica.
export const VOICEOVER_DIRECTION =
  'The dialogue is voice-over narration: there is no on-camera speaker, so do NOT lip-sync any face to it. Deliver it as a natural, warm spoken voice-over, not as on-camera speech.';

// Con 2+ personajes del Cast en cámara, fija que SOLO uno habla: red determinista que
// respalda el nudge del matcher (PD-13, estocástico, que a veces deja "They … Dialogue").
// Evita que el modelo sincronice las dos bocas o que ambos hablen al unísono.
export const MULTI_SPEAKER_DIRECTION =
  'Only ONE person speaks this line on camera; the other people stay silent and attentive (mouth closed, listening or reacting). Lip-sync the single speaker only — never animate two mouths talking at once.';

// Heurística determinista: la dirección de habla EN CÁMARA (lip sync) SOLO entra
// cuando la acción trae diálogo explícito — líneas guionizadas (Dialogue: "..."),
// texto entre comillas o verbos de habla. Tener personajes en escena NO implica
// que hablen (decisión del usuario 2026-06-12: diálogos solo si los pide o los da).
export function hasSpokenDialogue(text: string): boolean {
  return (
    /\bdialogue\s*:/i.test(text) ||
    /"[^"\n]{2,}"/.test(text) ||
    /[“”][^“”\n]{2,}[“”]/.test(text) ||
    /\b(speaks?|speaking|says|saying|delivers? a line|voice-?over)\b/i.test(text)
  );
}

// Voz presente en la escena (más amplio que el diálogo explícito): habla, VO,
// narración o un hablante claro (presentador/entrevista/recomendación). Controla
// la directiva de idioma+acento — NO el lip sync. Sin esto, antes se inyectaba la
// directiva de voz a clips de puro producto (el-icono, susurro), arriesgando una
// narración espuria que nadie pidió.
export function sceneHasVoice(text: string): boolean {
  if (hasSpokenDialogue(text)) return true;
  return /\b(voice-?over|narrat\w+|presenter|interviewer|to camera|to the camera|recommendation|verdict|asks?\b|answers?)\b/i.test(
    text,
  );
}

// ¿La voz es NARRACIÓN EN OFF (voiceover), no habla en cámara? Marca explícita en el
// guion (Voiceover/VO/narración/voz en off). Separa lip-sync (on-camera) de VO: una
// línea entrecomillada bajo "Voiceover:" es voz, pero NO debe disparar lip-sync.
export function isVoiceover(text: string): boolean {
  return /\bvoice-?over\b|\bvoiceover\b|\bnarrat\w+|\bvoz en off\b|\bnarrador\w*/i.test(text);
}

// Timing (la T de CRAFT): para clips >8s con varias acciones, reparte la acción
// en marcadores por segundos cuando el scenePrompt no trae ya un timeline. El
// matcher LLM suele entregarlo en planes dirigidos; esto cubre el mix/semillas
// determinista, donde antes un clip largo multi-acción salía sin reparto de tiempo.
function hasTimeline(text: string): boolean {
  return /\b\d{1,2}\s*[-–]\s*\d{1,2}\s*s\b|\b\d{1,2}\s*s\s*:/i.test(text);
}

// Reparte la acción en marcadores de tiempo SOLO si quedan pocos beats limpios.
// Beats = ORACIONES (límite . o ;), NO comas: antes partía por cada coma —incluso
// las descriptivas ("a woman with brown hair, wearing a beige top")— y generaba un
// timeline por SEGUNDO ("0-1s:.. 1-2s:..", con tramos de duración cero "4-4s") que
// hacía al modelo cambiar de plano cada segundo → video TRABADO. Ahora se topa a
// ~1 beat por 4s (guía: 1 idea ≈ 4s); si no encaja en pocos beats, se deja como
// prosa y el modelo reparte el tiempo (como en los prompts que salen fluidos).
// Los diálogos entrecomillados se protegen antes de partir: una frontera de
// oración DENTRO de comillas no es un beat — partir ahí rompía las comillas y
// dejaba un marcador de tiempo a media línea hablada.
function toTimeline(action: string, duration: number): string {
  const maxBeats = Math.max(2, Math.floor(duration / 4));
  const guards: string[] = [];
  const guarded = action.replace(/["“][^"“”]*["”]/g, (m) => `\u0000${guards.push(m) - 1}\u0000`);
  const restore = (s: string) => s.replace(/\u0000(\d+)\u0000/g, (_m, i) => guards[Number(i)]);
  const beats = guarded
    .split(/(?<=[.;])\s+/)
    .map((b) => b.trim().replace(/[.;]+$/, ''))
    .filter((b) => restore(b).length > 3);
  if (beats.length < 2 || beats.length > maxBeats) return action.trim();
  return `${beats
    .map((beat, i) => {
      const start = Math.round((duration * i) / beats.length);
      const end = Math.round((duration * (i + 1)) / beats.length);
      return `${start}-${end}s: ${restore(beat)}`;
    })
    .join('. ')}.`;
}

// Fluidez del habla (2026-07-07): las guías de comunidad de Seedance 2.0 coinciden
// en que las líneas de 5-10 palabras sincronizan bien y las largas salen masticadas
// ("mushier mouth movements"). Un diálogo largo multi-frase se parte en segmentos
// Dialogue: "..." cortos con un beat de pausa escrito entre ellos — el modelo usa
// los beats escritos como ancla de resincronización. Solo en el prompt enviado; el
// diálogo guardado no cambia (misma política que la normalización es-MX). Se parte
// en fronteras de oración y, si la frase única es larga, en sus pausas internas
// (coma/punto y coma) — nunca en frontera arbitraria de palabra.
// Fase 2 audio (2026-07-13): el beat ya NO ordena "pauses briefly" (sonaba a
// silencio dramático → "pausa mucho") sino una respiración breve sin corte; y el
// umbral sube 11→14 para no trocear líneas medias, que la cláusula de fluidez
// (DIALOGUE_LANGUAGE) ya sostiene. El troceo se conserva SOLO para líneas largas
// (≥14) que Seedance realmente mastica — es la red anti-atropellado.
export const DIALOGUE_PAUSE_BEAT =
  ' The speaker takes only a quick, natural breath and continues the same line smoothly, without a long or dramatic pause. ';
const DIALOGUE_SPLIT_MIN_WORDS = 14;
// Techo de palabras por segmento hablado (guía 5-10): al partir una frase única
// por sus pausas internas, los tramos se fusionan greedy sin rebasarlo.
const DIALOGUE_SEGMENT_MAX_WORDS = 10;

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Una frase única larga se parte en sus PAUSAS naturales (coma, punto y coma,
// dos puntos, raya): son puntos de respiración reales del habla, no cortes a
// media cláusula (caso 2026-07-07: 17 palabras sin punto salían masticadas y el
// modelo "se equivocaba" al decirlas). Sin pausas internas, la línea queda
// entera (conservador: nunca partir en frontera arbitraria de palabra).
function splitAtPauses(inner: string): string[] {
  const chunks = inner
    .split(/(?<=[,;:—])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (chunks.length < 2) return [inner];
  const segments: string[] = [];
  let current = '';
  for (const chunk of chunks) {
    const candidate = current ? `${current} ${chunk}` : chunk;
    if (current && countWords(candidate) > DIALOGUE_SEGMENT_MAX_WORDS) {
      segments.push(current);
      current = chunk;
    } else {
      current = candidate;
    }
  }
  if (current) segments.push(current);
  // La puntuación de pausa al final del tramo sobra: el beat escrito entre
  // segmentos ya marca la respiración (se conservan . ! ? …).
  return segments.map((s) => s.replace(/[,;:—]$/, ''));
}

export function splitLongDialogues(action: string): string {
  return action.replace(
    /(dialogue|di[aá]logo)(\s*:\s*)(["“])([^"“”]*)(["”])/gi,
    (full, marker: string, sep: string, qOpen: string, inner: string, qClose: string) => {
      const words = inner.trim().split(/\s+/).filter(Boolean).length;
      if (words < DIALOGUE_SPLIT_MIN_WORDS) return full;
      const sentences = inner
        .split(/(?<=[.!?…])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const segments = sentences.length >= 2 ? sentences : splitAtPauses(inner.trim());
      if (segments.length < 2) return full;
      return segments.map((s) => `${marker}${sep}${qOpen}${s}${qClose}`).join(DIALOGUE_PAUSE_BEAT);
    },
  );
}

// Tope de trabajo del prompt: ModelArk/Atlas no documentan límite de caracteres
// y prompts de 8347 ya pasaron en producción (path storyboard, que además
// apende citas DESPUÉS del compile). El techo duro del sistema es el schema de
// generación (12000); este budget deja margen para esos apéndices. Historial:
// 4000 y luego 6000 se comían la acción COMPLETA cuando el ANDAMIAJE fijo
// (locación+producto+personaje+vestuario+escala+voz+es-MX) superaba solo el
// budget — el recorte solo sabe recortar la acción, así que el salvamento
// "gancho+diálogo" se disparaba en TODOS los clips y el modelo recibía
// lip-sync sin guion (bugs 2026-07-02 audio inventado y 2026-07-07 Anuncio
// #12 sin acciones). El budget debe superar el andamiaje real (~7-8k) con
// margen para la acción.
const PROMPT_CHAR_BUDGET = 10000;

// Recorta la acción en frontera de frase/palabra para no cortar a media palabra
// cuando el prompt compilado excede el techo duro.
function clampToBudget(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, Math.max(0, max));
  const dot = cut.lastIndexOf('. ');
  const space = cut.lastIndexOf(' ');
  const at = dot > max * 0.5 ? dot + 1 : space > 0 ? space : cut.length;
  return cut.slice(0, at).trim();
}

// Construye las referencias EN ORDEN (la posición define @Image1.., @Video1..).
// Prioridad ante el tope de 12: producto > empaque > personaje > extra > cámara > audio
// (tier list de la guía Morphic §8). El tope de 9 imágenes se aplica antes;
// el tope de 12 archivos totales es la red de seguridad final.
export function buildReferences(ctx: DirectorContext): {
  references: CompiledReference[];
  lines: string[];
  warnings: string[];
} {
  const references: CompiledReference[] = [];
  const lines: string[] = [];
  const warnings: string[] = [];
  let imageN = 0;
  let droppedImages = 0;
  // T5: paridad single — primer producto de la lista (multi real llega en T6).
  const primary = ctx.products?.[0];

  const pushImage = (
    storagePath: string,
    role: CompiledReference['role'],
    line: ((n: number) => string) | null,
    scope?: string,
  ): number | null => {
    if (imageN >= 9) {
      droppedImages += 1;
      return null;
    }
    imageN += 1;
    references.push({ storagePath, kind: 'image', role, scope });
    if (line) lines.push(line(imageN));
    return imageN;
  };

  // Selección manual (applyReferenceSelection): las listas ya vienen filtradas
  // por el usuario, así que los topes POR CATEGORÍA se levantan — el usuario es
  // el presupuesto. El tope global de 9 (pushImage) sigue siendo la red.
  const manual = ctx.manualRefs === true;
  // Producto: máx 3 ángulos como referencia (frontal, perfil, detalle) para
  // dejar slots libres; el Brand Kit puede traer más.
  // En manual no se pre-recorta: pushImage aplica el tope de 9 y CUENTA los
  // drops (el pre-slice silenciaba el warning de recorte).
  const productImages = primary?.imagePaths.slice(0, manual ? Infinity : 3) ?? [];
  const productUsages = primary?.imageUsages ?? {};
  for (const path of productImages) {
    const usage = productUsages[path];
    pushImage(
      path,
      'product',
      (n) =>
        `@image${n} is the product${usage ? `, shown here as ${usage}` : ''} — keep its design, colors, logo and proportions consistent; any printed photo or text on it stays a still print, not animated.`,
    );
  }
  // AM: con 2+ vistas, dile al modelo que son el MISMO objeto (evita que trate
  // el 3/4 generado como un producto distinto).
  if (productImages.length >= 2) {
    lines.push(
      'The product reference images show the SAME single product from different views; reconcile them into one consistent object — do not treat them as different products.',
    );
  }

  // Empaque (solo si el formato lo exige está en el contexto).
  const packagingImages = primary?.packagingImagePaths?.slice(0, manual ? Infinity : 2) ?? [];
  for (const path of packagingImages) {
    pushImage(path, 'packaging', (n) => `@image${n} is the product packaging, shown exactly as in the reference.`);
  }

  // Personajes: presupuesto de ángulos según cuántos van en escena
  // (1 → master+2, 2 → master+1, 3 → solo master), para caber en 9 imágenes.
  const characters = (ctx.characters ?? []).slice(0, 3);
  // Manual: los ángulos ya son exactamente los elegidos, no re-recortar por presupuesto.
  const anglesPer = manual ? Infinity : characters.length >= 3 ? 0 : characters.length === 2 ? 1 : 2;
  for (const character of characters) {
    if (!character.masterImagePath) continue;
    const stateLabel = character.stateLabel;
    pushImage(
      character.masterImagePath,
      'character',
      (n) =>
        stateLabel
          ? character.fullBodyImagePath
            ? `@image${n} is ${character.name} — keep the exact face, hair, build and identity, and the ${stateLabel} skin and physical condition shown here; only the physical state may differ, never who they are.`
            : `@image${n} is ${character.name} — keep the exact face, hair, build and identity, and the ${stateLabel} wardrobe and skin condition shown here; only the physical state may differ, never who they are.`
          : `@image${n} is ${character.name} — use only the face, hair and build from this reference (not its clothing or background), kept consistent.`,
      stateLabel ? `identidad exacta + vestuario/piel del estado ${stateLabel}` : 'rostro, peinado y complexión; no la ropa ni el fondo',
    );
    // Vestuario (specs/v2/16): cuerpo completo INMEDIATAMENTE tras la maestra y
    // ANTES de los ángulos — con el tope global de 9, la posición hace que sean
    // los ángulos los que caigan primero si falta presupuesto (prioridad
    // intencional, no lógica especial).
    if (character.fullBodyImagePath) {
      pushImage(
        character.fullBodyImagePath,
        'character',
        (n) =>
          `@image${n} is ${character.name}'s full-body wardrobe reference — keep this exact same clothing, silhouette and body proportions in every shot; identity (face and hair) comes from the previous reference.`,
        'vestuario, silueta y proporciones de cuerpo completo',
      );
    }
    // Ángulos extra: se citan AGRUPADOS en una sola línea (no una por imagen,
    // que apilaba directivas redundantes y saturaba el prompt).
    const angleNums: number[] = [];
    for (const path of character.angleImagePaths?.slice(0, anglesPer) ?? []) {
      const an = pushImage(path, 'character', null);
      if (an) angleNums.push(an);
    }
    if (angleNums.length === 1) {
      lines.push(`@image${angleNums[0]} shows ${character.name} from another angle, for consistency.`);
    } else if (angleNums.length > 1) {
      lines.push(`@image${angleNums.join(' and @image')} show ${character.name} from other angles, for consistency.`);
    }
  }

  // Locación de la secuencia: entorno re-anclado en cada clip. Va antes de los
  // extras del refinado en prioridad. Mismo rol environment.
  for (const path of ctx.location?.imagePaths ?? []) {
    pushImage(
      path,
      'environment',
      (n) =>
        `@image${n} is the location/setting — keep the same place, architecture, background, lighting and overall look consistent across shots.`,
    );
  }

  // P15: mapa de escala top-down. Va tras la locación y antes de los extras en
  // prioridad. Directiva propia: NO es una escena a renderizar, fija proporciones.
  if (ctx.location?.scaleMap) {
    const { path, notes } = ctx.location.scaleMap;
    pushImage(
      path,
      'scale_map',
      (n) =>
        `@image${n} is a TOP-DOWN SCALE SCHEMATIC of the set, not a scene to render: ` +
        `it fixes the relative SIZE and POSITION of the elements` +
        (notes ? ` — ${notes}` : '') +
        `. Keep these proportions and placement consistent across shots; do not resize or ` +
        `relocate objects, and do not copy its flat diagram look into the video.`,
    );
  }

  // Referencias extra del refinado: entorno/estilo, última prioridad.
  for (const path of ctx.extraImagePaths ?? []) {
    pushImage(path, 'environment', (n) => `@image${n} is an additional scene reference — match its environment, mood and look.`);
  }

  if (droppedImages > 0) {
    warnings.push(
      `referencias: ${droppedImages} imágenes recortadas por el tope de 9 del modelo (prioridad: producto > empaque > personaje > locación > mapa de escala > extra)`,
    );
  }

  // Video de plantilla viva: estructura, cámara y ritmo.
  if (ctx.templateVideoPath) {
    references.push({ storagePath: ctx.templateVideoPath, kind: 'video', role: 'camera_motion' });
    lines.push(
      '@video1 is the structural reference — replicate its camera moves, shot structure, editing rhythm and color grading exactly; replace only the product and scene contents as described below.',
    );
  }

  // Audio de referencia: un único slot @audio1. La voz del hablante gana sobre la
  // música (el usuario la asignó al personaje); si no hay voz, va la música.
  if (ctx.voiceRefPath) {
    references.push({ storagePath: ctx.voiceRefPath, kind: 'audio', role: 'voice_ref' });
    lines.push(VOICE_TIMBRE_CITATION);
  } else if (ctx.audioRefPath) {
    references.push({ storagePath: ctx.audioRefPath, kind: 'audio', role: 'audio_rhythm' });
    lines.push(AUDIO_BEAT_SYNC_CITATION);
  }

  if (references.length > 12) {
    // Recorte por prioridad: el orden de construcción YA es la prioridad,
    // así que basta cortar desde el final.
    const dropped = references.length - 12;
    references.length = 12;
    lines.length = Math.min(lines.length, 12);
    warnings.push(`referencias: ${dropped} recortadas por el tope de 12 archivos (prioridad: producto > empaque > personaje > extra > cámara > audio)`);
  }

  return { references, lines, warnings };
}

// Términos que indican que la luz/óptica YA está dirigida (en el scenePrompt o
// en la dirección del formato): si están, no se inyecta el default para no
// duplicar ni contradecir. NO incluye tipos de plano (close-up, etc.): esos son
// encuadre, no luz.
const LIGHT_OR_LENS_RE =
  /\b(light|lighting|lit|backlit|key ?light|fill light|rim light|softbox|golden hour|neon|silhouette|depth of field|bokeh|shallow focus|deep focus|wide[- ]angle|telephoto|lens|luz|iluminaci|contraluz|profundidad de campo)\b/i;

// Default determinista de cinematografía (luz + óptica) por registro del formato
// (#A). Da una base coherente cuando ni el scenePrompt ni el formato la
// especifican: UGC/handheld → luz natural y foco profundo; hero/cinematic →
// key light controlada y profundidad de campo corta.
// Registros de formato que piden una estética estilizada/surreal (el-icono,
// mundo-imposible): ahí "ultra realistic" contradice el look del formato.
export const STYLIZED_VIDEO_REGISTER_RE =
  /\b(surreal|imposible|impossible|stylized|estilizad|abstract|abstracto|surrealist|hyperreal|dreamlike|onírico|animat)\w*/i;

// Look de video efectivo para un perfil + register de formato. Exportada: los
// clips ENCADENADOS (advanceSequenceChain) no pasan por este compiler y deben
// re-anclar EXACTAMENTE el mismo look que llevó el clip 1 — incluida la
// degradación a solo filmic cuando el register es estilizado.
export function resolveVideoLook(profile: StyleProfile, register: string): string {
  if (!profile.photoreal) return profile.video;
  return STYLIZED_VIDEO_REGISTER_RE.test(register) ? 'filmic color grading' : profile.video;
}

function cinematographyDefault(register: string): string {
  const handheld =
    /handheld|selfie|ugc|vlog|casual|conversacional|primera persona|testimon|a pie de calle|\bcalle\b/i.test(register);
  return handheld
    ? 'Cinematography: natural available light with soft, realistic shadows; handheld camera feel with subtle natural micro-movement and slightly imperfect framing, as if filmed by a real camera operator; deep focus so the whole scene reads clearly.'
    : 'Cinematography: controlled key light with soft fill and gentle rim separation; shallow depth of field that keeps the product crisp; clean filmic contrast.';
}

// Música/foley por registro (#2 audio): decide la cama sonora de forma
// determinista en vez de dejar al modelo interpretar "si el registro lo pide".
// El sonido diegético específico de la acción lo aporta el matcher (#1).
function audioDirection(register: string): string {
  const r = register.toLowerCase();
  if (/asmr|susurro|whisper|macro|t[aá]ctil/.test(r)) {
    return 'Audio: no music. Foley-forward — every contact and texture sound crisp, close and detailed; let the product sounds carry the scene.';
  }
  if (ENERGETIC_REGISTER_RE.test(r)) {
    return 'Audio: a rhythmic music bed whose energy matches the cut; keep the key diegetic product sounds audible over it.';
  }
  if (/cinemat|[eé]pic|gran ?pantalla|brand ?film|emotiv|emotion/.test(r)) {
    return 'Audio: a restrained cinematic score supporting the mood, low under the action; natural diegetic sound stays present.';
  }
  return 'Audio: natural diegetic sound that matches the scene, no music — keep it real, with subtle room tone.';
}

// Clips con voz (diálogo o voz en off): sin música para que la voz no compita.
// "no music" literal es más fiable que "no background music". Los clips SIN voz
// conservan su música por registro (audioDirection).
const VOICE_FORWARD_AUDIO =
  'Audio: no music — the spoken voice carries the scene; keep only subtle diegetic room tone under the dialogue, with the voice clear and forward in the mix.';

export function compileSeedance(
  req: CompileRequest,
  ctx: DirectorContext,
): CompiledPrompt {
  const warnings: string[] = [];
  const { references, lines, warnings: refWarnings } = buildReferences(ctx);
  warnings.push(...refWarnings);

  const duration = req.durationS ?? ctx.format?.defaultDurationS;
  const generateAudio = req.generateAudio ?? ctx.format?.defaultAudio ?? true;
  // Lip-sync SOLO para habla EN cámara: un voiceover (narración en off) es voz pero
  // sin hablante en cámara → no debe recibir SPEECH_DIRECTION (lip-sync), que el
  // modelo resolvía con voz robótica al "sincronizar" una cara inexistente.
  const voiceover = isVoiceover(req.scenePrompt);
  const speaker = generateAudio && hasSpokenDialogue(req.scenePrompt) && !voiceover;
  const voiced = generateAudio && sceneHasVoice(req.scenePrompt);

  const sections: string[] = [];

  // Encabezado: qué pieza es, antes de cualquier detalle (estructura del
  // ejemplo validado: duración + orientación + estilo base primero). El look
  // base sigue al registro del formato: "ultra realistic" se omite en formatos
  // estilizados/surreales (el-icono, mundo-imposible) donde contradice la estética.
  const aspect = req.aspectRatio ?? '9:16';
  const orientation = aspect === '9:16' || aspect === '3:4' ? 'vertical' : aspect === '1:1' ? 'square' : 'horizontal';
  const profile = getStyleProfile(ctx.style?.slug, ctx.style?.custom);
  const stylizedRegister = STYLIZED_VIDEO_REGISTER_RE.test(ctx.format?.register ?? '');
  const look = resolveVideoLook(profile, ctx.format?.register ?? '');
  sections.push(
    `A ${duration ? `${duration}-second ` : ''}${orientation} (${aspect}) commercial video, ${look}.`,
  );

  // R — Referencias primero, cada @ con propósito declarado.
  if (lines.length) sections.push(lines.join(' '));

  // Integración personaje-locación (spec 2026-07-02) — espejo del panel.
  if (
    (ctx.characters?.length ?? 0) > 0 &&
    ((ctx.location?.imagePaths?.length ?? 0) > 0 || ctx.location?.description?.trim())
  ) {
    sections.push(SCENE_INTEGRATION_CLAUSE);
  }

  // Habla en cámara: temprano y destacado (como el bloque VERY IMPORTANT del
  // ejemplo) — la calidad del lip sync depende de que el modelo lo lea antes
  // de la acción.
  if (speaker) {
    sections.push(SPEECH_DIRECTION);
    // Mantiene al hablante físicamente vivo (contra el "parado/tieso" de clips cortos).
    sections.push(SPEAKER_LIVELINESS);
    // 2+ personajes del Cast en cámara → fija un solo hablante (PD-15).
    if ((ctx.characters?.length ?? 0) >= 2) sections.push(MULTI_SPEAKER_DIRECTION);
  } else if (generateAudio && voiced && voiceover) {
    sections.push(VOICEOVER_DIRECTION);
  }

  // C — Contexto: la escena.
  if (ctx.scene?.fragment) sections.push(`Scene: ${ctx.scene.fragment}.`);

  if (ctx.location?.description?.trim()) {
    sections.push(`Location: ${ctx.location.description.trim()}.`);
  }
  // Perfil de luz de la locación (052) — espejo del panel: la luz REAL de la
  // escena en texto para integrar a las personas con esa luz.
  if (ctx.location?.lightProfile?.trim()) {
    sections.push(`Scene light and space: ${ctx.location.lightProfile.trim().replace(/\.+$/, '')}.`);
  }

  // Fidelidad de producto y personajes (reglas duras del inventario). La
  // cláusula de fidelidad se omite cuando la línea @Image ya la declara (hay
  // imagen de referencia): se deja solo los hechos, sin duplicar verbatim.
  const primaryProduct = ctx.products?.[0];
  if (primaryProduct) {
    sections.push(describeProduct(primaryProduct, { fidelity: !primaryProduct.imagePaths.length }));
    const weight = describeProductWeight(primaryProduct);
    if (weight) sections.push(weight.trim());
  }
  for (const character of ctx.characters ?? []) {
    // Sin descripción (describeFromMaster es best-effort y el usuario pudo no
    // teclear nada): la hoja maestra fija la cara, pero el modelo queda sin
    // vestuario ni actitud → personaje inconsistente entre tomas. Se avisa y se
    // omite la línea vacía 'Nombre: .' en vez de empujarla en silencio.
    if (!character.description?.trim()) {
      warnings.push(
        character.masterImagePath
          ? `identidad: ${character.name} no tiene descripción; la hoja maestra fija la cara pero el vestuario y la actitud quedan sin dirección y variarán entre tomas`
          : `identidad: ${character.name} no tiene descripción ni hoja maestra; su apariencia no está definida`,
      );
      continue;
    }
    const { text, ageWordsRemoved } = describeCharacter(character, {
      fidelity: !character.masterImagePath,
    });
    sections.push(text);
    if (ageWordsRemoved.length) {
      warnings.push(`edad: se removieron marcadores de la descripción de ${character.name} (${ageWordsRemoved.join(', ')})`);
    }
  }

  // Dirección de actuación (P20): restraint consciente del registro, solo cuando
  // hay rostro intencional (personaje del Cast o hablante en cámara) y el beat no
  // declara una emoción grande. Convive con SPEECH_DIRECTION (lip-sync) y
  // cinematographyDefault (luz): esto es la INTENSIDAD de la performance.
  const actingDir = actingDirectionFor(
    ctx.format?.register ?? '',
    declaresHighEmotion(req.scenePrompt),
  );
  if (actingDir && facesIntended(ctx, speaker)) sections.push(actingDir);

  // A — Acción: el scene_prompt del plan, sin reescritura. Guardamos su índice
  // para poder recortarla (y solo a ella) si el prompt final excede el techo.
  // T — Timing: si el clip dura 5s o más y la acción tiene varios beats sin timeline,
  // se reparte en marcadores por segundos (CRAFT; cubre el camino de semillas).
  const actionIndex = sections.length;
  const rawAction =
    duration && duration >= 5 && !hasTimeline(req.scenePrompt)
      ? toTimeline(req.scenePrompt.trim(), duration)
      : req.scenePrompt.trim().replace(/\.?$/, '.');
  // Habla es-MX: primero se normalizan números/símbolos del DIÁLOGO ($499, 2x1,
  // 24/7, 3km, Dr.) a palabras —un token crudo se masca en la voz—, luego se
  // aplica el respelling de tónica (mapa curado), y al final los diálogos largos
  // multi-frase se parten en segmentos cortos con beat de pausa (fluidez). Todos
  // los pasos tocan SOLO el diálogo entrecomillado, nunca el andamiaje del prompt
  // (9:16, 480p, 3-7s:, @imageN). Solo en el prompt enviado; el diálogo guardado
  // no cambia.
  const action0 = splitLongDialogues(applyRespellings(normalizeSpokenInDialogue(rawAction)));
  const action = voiced
    ? injectDeliveryCue(action0, deliveryCueFor(req.voiceTone, ctx.format?.register ?? '', req.scenePrompt))
    : action0;
  sections.push(action);

  // F — Encuadre, registro y ritmo del formato.
  if (ctx.format) {
    const d = directionFor(ctx.format);
    const direction = [d.framing, d.register, d.pacing].filter(Boolean).join(' ');
    if (direction) sections.push(direction);
  }

  // Guías creativas opt-in de la campaña: encuadre producto-completo / hook-hero /
  // recorte seguro. Gateadas por flag; el hook-hero solo en el beat de apertura.
  const guidelineClauses = creativeGuidelineClauses(ctx.guidelines, { isOpeningBeat: req.isOpeningBeat });
  if (guidelineClauses) sections.push(guidelineClauses.trim());

  // Cinematografía por defecto (#A): base de luz/óptica coherente cuando ni la
  // acción ni el formato la especifican. Se omite en formatos estilizados (look
  // propio), cuando hay referencia de look/entorno o video de plantilla (el
  // modelo extrae la luz de ahí), y cuando la campaña declara un perfil
  // no-realista (animado/fantasía/custom): el lenguaje fotográfico ("as if
  // filmed by a real camera operator" / "clean filmic contrast") contradice el
  // look declarado en el encabezado del video.
  const hasLookReference =
    (ctx.extraImagePaths?.length ?? 0) > 0 ||
    (ctx.location?.imagePaths?.length ?? 0) > 0 ||
    !!ctx.templateVideoPath;
  const lightAlreadyDirected = LIGHT_OR_LENS_RE.test(
    `${req.scenePrompt} ${ctx.format?.cameraStyle ?? ''} ${ctx.format?.register ?? ''}`,
  );
  // DELIBERADO: gate por slug, NO por profile.photoreal — 'casero' es foto-real
  // pero esta base describe luz de operador profesional (key/fill/rim) que
  // contradiría su look handheld de celular; su luz ya viene del encabezado.
  if (profile.slug === 'ultra_realista' && !stylizedRegister && !hasLookReference && !lightAlreadyDirected) {
    sections.push(cinematographyDefault(ctx.format?.register ?? ''));
  }

  // Audio dirigido por registro (#2): música/foley deciden aquí, no "si el
  // registro lo pide". El sonido específico de la acción viene del matcher (#1).
  if (generateAudio && !ctx.audioRefPath) {
    sections.push(voiced ? VOICE_FORWARD_AUDIO : audioDirection(ctx.format?.register ?? ''));
  }
  // Idioma/acento de la voz SOLO cuando hay habla o narración en la escena.
  // Si no la hay, se le cierra la puerta a una voz en off no pedida. El tono de
  // entrega ya va pegado a la cita del diálogo (cue adyacente, ver action arriba).
  if (voiced) {
    sections.push(DIALOGUE_LANGUAGE[ctx.language ?? 'es']);
  } else if (generateAudio) {
    sections.push('No spoken dialogue or voice-over; ambient sound only.');
  }

  sections.push(NEGATIVE_CLAUSE);
  // Guard anti-rostros solo si NINGÚN rostro es intencional (mismo criterio que la
  // directiva de actuación, ahora compartido en acting.ts).
  if (!facesIntended(ctx, speaker)) sections.push(NO_REAL_FACES_CLAUSE);

  const hasRefs = references.length > 0;
  let prompt = sections.filter(Boolean).join('\n');
  if (prompt.length > PROMPT_CHAR_BUDGET) {
    // Recortamos SOLO la acción, dejando intactas las cláusulas finales
    // obligatorias (idioma del diálogo, cláusula negativa). EL GUION ES SAGRADO
    // (bug 2026-07-02): si el recorte se comería el diálogo — o la acción entera,
    // cuando el desborde supera su largo — el modelo recibe SPEECH_DIRECTION sin
    // guion y INVENTA el audio. En ese caso se reconstruye la acción como gancho
    // (primera frase) + segmentos de diálogo completos, aunque el prompt quede
    // por encima del budget: el techo real del sistema es 12000 y un prompt largo
    // es infinitamente mejor que un lip-sync improvisado.
    const overflow = prompt.length - PROMPT_CHAR_BUDGET;
    const action = sections[actionIndex];
    const trimmed = clampToBudget(action, Math.max(0, action.length - overflow));
    const dialogues = action.match(/(?:dialogue|di[aá]logo)\s*:\s*["“][^"“”]*["”]\.?/gi) ?? [];
    const keepsDialogue = dialogues.every((d) => trimmed.includes(d));
    if ((action.length > 0 && trimmed.length === 0) || !keepsDialogue) {
      const firstDot = action.indexOf('. ');
      const hook = firstDot > 0 ? action.slice(0, firstDot + 1) : action.split('\n')[0];
      const rebuilt = [hook, ...dialogues.filter((d) => !hook.includes(d))].join(' ').trim();
      sections[actionIndex] = rebuilt || action;
      warnings.push(
        `prompt: excede el techo de ${PROMPT_CHAR_BUDGET} caracteres incluso preservando solo gancho y diálogo; divide el creativo en escenas`,
      );
    } else {
      sections[actionIndex] = trimmed;
      warnings.push(
        `prompt: la acción se recortó para caber en el techo de ${PROMPT_CHAR_BUDGET} caracteres; divide el creativo en escenas para usar todo el guion`,
      );
    }
    prompt = sections.filter(Boolean).join('\n');
  }

  return {
    modelSlug: req.modelSlug,
    prompt,
    params: {
      operation: hasRefs ? 'reference2video' : 'text2video',
      duration,
      aspectRatio: req.aspectRatio ?? '9:16',
      resolution: req.resolution ?? (req.modelSlug.includes('/fast/') ? '480p' : '720p'),
      generateAudio,
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
    },
    references,
    warnings,
  };
}
