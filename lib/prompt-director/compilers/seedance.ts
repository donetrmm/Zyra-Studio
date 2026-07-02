// Compiler de Seedance 2.0 (specs/v2/02 tarea 4): produce el prompt CRAFT
// (Context → Reference → Action → Framing → Timing) con referencias @ en el
// orden exacto en que el handler las firma y envía. Guía completa en
// docs/modelos/06-seedance-2.md.

import { describeCharacter, describeProduct } from '../inventory';
import { normalizeSpokenInDialogue } from '../es-mx-normalize';
import { directionFor } from '../format-director';
import { applyRespellings } from '../pronunciation';
import { actingDirectionFor, declaresHighEmotion, facesIntended, ENERGETIC_REGISTER_RE } from '../acting';
import { creativeGuidelineClauses } from '@/lib/campaigns/guidelines';
import { getStyleProfile } from '../style-profiles';
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
const NEGATIVE_CLAUSE =
  'No on-screen text overlays, captions, subtitles or watermarks added by the model. Do not invent or add any logo or typography that is not physically part of the referenced product.';

// Guard anti-rostros: SOLO cuando NINGÚN rostro es intencional (clip de puro
// producto/abstracto), para que el modelo no fabrique una persona real espuria.
// Si hay personaje del Cast (cara anclada por referencia) o habla EN cámara
// (lip-sync), el rostro ES el objetivo del clip y prohibir "rostros reales" se
// contradice con la referencia y la dirección de lip-sync → degrada la cara.
const NO_REAL_FACES_CLAUSE = 'No real, identifiable human faces.';

// Directiva de beat-sync del audio de referencia. Fuente única: la cita el compiler
// normal (rama @audio1) y la rama R2V del storyboard (buildCastR2VRefs) para que la
// dirección de música sea idéntica en todo el producto. Sin espacio inicial: el
// compiler la usa como línea propia; el storyboard antepone el espacio al concatenar.
export const AUDIO_BEAT_SYNC_CITATION =
  '@audio1 sets the background audio mood and rhythm; sync scene energy to its beats.';

// El prompt va en inglés (rinde mejor), pero sin esta directiva el modelo
// genera los diálogos en inglés. Exportada: la reusan las variantes.
// La dirección de voz natural (cadencia, pausas, anti-locutor) viene del
// prompt de ejemplo validado a mano (2026-06-12): sin ella la voz sale
// robótica. OJO: acento mexicano sustituye al "neutral LatAm" original —
// decisión tomada de ese ejemplo que funcionó.
export const DIALOGUE_LANGUAGE: Record<'es' | 'en', string> = {
  es: 'All spoken dialogue and any voice-over must be in Spanish with a natural Mexican accent. Use authentic human cadence: warm conversational tone, subtle pauses and breathing, slight imperfections and natural emotional variation. Avoid robotic speech, announcer voice, monotone delivery and exaggerated acting — speak as if talking naturally to a friend. Even while natural, articulate every word completely and correctly: give each syllable of longer or less common words its full value, without slurring, dropping endings or rushing through consonant clusters.',
  en: 'All spoken dialogue and any voice-over must be in English. Use authentic human cadence: warm conversational tone, subtle pauses and breathing, slight imperfections and natural emotional variation. Avoid robotic speech, announcer voice, monotone delivery and exaggerated acting — speak as if talking naturally to a friend. Even while natural, articulate every word completely and correctly: give each syllable of longer or less common words its full value, without slurring, dropping endings or rushing through consonant clusters.',
};

// Lip sync y habla EN cámara (no narración): solo cuando hay un hablante en
// escena. Del mismo ejemplo validado a mano. Exportada: la reusan los clips de
// continuación de secuencia para no perder el lip-sync a mitad del anuncio.
export const SPEECH_DIRECTION =
  'The on-camera speaker talks directly to the camera: generate synchronized speech with accurate lip sync — natural mouth movements matching every spoken word, facial expressions and jaw timing following the dialogue, with realistic blinking, breathing and subtle head movements. Synchronized on-camera speech, not voice-over narration.';

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
function toTimeline(action: string, duration: number): string {
  const maxBeats = Math.max(2, Math.floor(duration / 4));
  const beats = action
    .split(/(?<=[.;])\s+/)
    .map((b) => b.trim().replace(/[.;]+$/, ''))
    .filter((b) => b.length > 3);
  if (beats.length < 2 || beats.length > maxBeats) return action.trim();
  return `${beats
    .map((beat, i) => {
      const start = Math.round((duration * i) / beats.length);
      const end = Math.round((duration * (i + 1)) / beats.length);
      return `${start}-${end}s: ${beat}`;
    })
    .join('. ')}.`;
}

// Tope de trabajo del prompt: ModelArk no documenta límite de caracteres;
// 4000 es el techo propio de SubmitSeedanceSchema — el compiler avisa antes de
// que un submit manual lo rechace.
const PROMPT_CHAR_BUDGET = 4000;

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

  // Producto: máx 3 ángulos como referencia (frontal, perfil, detalle) para
  // dejar slots libres; el Brand Kit puede traer más.
  const productImages = ctx.product?.imagePaths.slice(0, 3) ?? [];
  const productUsages = ctx.product?.imageUsages ?? {};
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
  const packagingImages = ctx.product?.packagingImagePaths?.slice(0, 2) ?? [];
  for (const path of packagingImages) {
    pushImage(path, 'packaging', (n) => `@image${n} is the product packaging, shown exactly as in the reference.`);
  }

  // Personajes: presupuesto de ángulos según cuántos van en escena
  // (1 → master+2, 2 → master+1, 3 → solo master), para caber en 9 imágenes.
  const characters = (ctx.characters ?? []).slice(0, 3);
  const anglesPer = characters.length >= 3 ? 0 : characters.length === 2 ? 1 : 2;
  for (const character of characters) {
    if (!character.masterImagePath) continue;
    const stateLabel = character.stateLabel;
    pushImage(
      character.masterImagePath,
      'character',
      (n) =>
        stateLabel
          ? `@image${n} is ${character.name} — keep the exact face, hair, build and identity, and the ${stateLabel} wardrobe and skin condition shown here; only the physical state may differ, never who they are.`
          : `@image${n} is ${character.name} — use only the face, hair and build from this reference (not its clothing or background), kept consistent.`,
      stateLabel ? `identidad exacta + vestuario/piel del estado ${stateLabel}` : 'rostro, peinado y complexión; no la ropa ni el fondo',
    );
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

  // Audio de referencia: mood y ritmo.
  if (ctx.audioRefPath) {
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

// Matiz de entrega de la voz por registro (#3 audio): se añade a la directiva de
// idioma/cadencia base (DIALOGUE_LANGUAGE) cuando hay voz en escena. null para
// registros UGC/casual, ya cubiertos por la cadencia base.
function voiceToneForRegister(register: string): string | null {
  const r = register.toLowerCase();
  if (/asmr|susurro|whisper|macro/.test(r)) return 'Deliver the voice intimately and softly, close to the mic, almost a whisper.';
  if (/calle|street|vox|interview|entrevista|espont/.test(r)) return 'Deliver the voice spontaneously and candidly, with light street energy, as if caught in the moment.';
  if (/bold|icono|kinet|en[eé]rg|beat/.test(r)) return 'Deliver the voice with confident, punchy energy.';
  if (/cinemat|[eé]pic|gran ?pantalla|brand ?film|emotiv/.test(r)) return 'Deliver the voice calm, sincere and emotionally grounded.';
  return null;
}

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
  const stylizedRegister = /\b(surreal|imposible|impossible|stylized|estilizad|abstract|abstracto|surrealist|hyperreal|dreamlike|onírico|animat)\w*/i.test(
    ctx.format?.register ?? '',
  );
  // Perfil declarado no-realista → su look manda. Perfil realista (o ausente)
  // con formato estilizado (el-icono, mundo-imposible) → se degrada a solo
  // filmic (comportamiento actual).
  const look =
    profile.slug !== 'ultra_realista'
      ? profile.video
      : stylizedRegister
        ? 'filmic color grading'
        : profile.video;
  sections.push(
    `A ${duration ? `${duration}-second ` : ''}${orientation} (${aspect}) commercial video, ${look}.`,
  );

  // R — Referencias primero, cada @ con propósito declarado.
  if (lines.length) sections.push(lines.join(' '));

  // Habla en cámara: temprano y destacado (como el bloque VERY IMPORTANT del
  // ejemplo) — la calidad del lip sync depende de que el modelo lo lea antes
  // de la acción.
  if (speaker) {
    sections.push(SPEECH_DIRECTION);
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

  // Fidelidad de producto y personajes (reglas duras del inventario). La
  // cláusula de fidelidad se omite cuando la línea @Image ya la declara (hay
  // imagen de referencia): se deja solo los hechos, sin duplicar verbatim.
  if (ctx.product) {
    sections.push(describeProduct(ctx.product, { fidelity: !ctx.product.imagePaths.length }));
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
  // aplica el respelling de tónica (mapa curado). Ambos pasos tocan SOLO el
  // diálogo entrecomillado, nunca el andamiaje del prompt (9:16, 480p, 3-7s:,
  // @imageN). Solo en el prompt enviado; el diálogo guardado no cambia.
  const action = applyRespellings(normalizeSpokenInDialogue(rawAction));
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
  if (profile.slug === 'ultra_realista' && !stylizedRegister && !hasLookReference && !lightAlreadyDirected) {
    sections.push(cinematographyDefault(ctx.format?.register ?? ''));
  }

  // Audio dirigido por registro (#2): música/foley deciden aquí, no "si el
  // registro lo pide". El sonido específico de la acción viene del matcher (#1).
  if (generateAudio && !ctx.audioRefPath) {
    sections.push(audioDirection(ctx.format?.register ?? ''));
  }
  // Idioma/acento de la voz SOLO cuando hay habla o narración en la escena.
  // Si no la hay, se le cierra la puerta a una voz en off no pedida. Con voz, el
  // tono de entrega se matiza por registro (#3) sobre la cadencia base.
  if (voiced) {
    sections.push(DIALOGUE_LANGUAGE[ctx.language ?? 'es']);
    const tone = voiceToneForRegister(ctx.format?.register ?? '');
    if (tone) sections.push(tone);
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
    // Garantía dura: el prompt compilado no puede pasar de 4000 (cap de
    // SubmitSeedanceSchema). Recortamos SOLO la acción —preservando su inicio
    // (gancho + primer diálogo) y dejando intactas las cláusulas finales
    // obligatorias (idioma del diálogo, cláusula negativa)— en vez de dejar que
    // el submit rechace el guion. Si no cabe, hay que dividirlo en escenas.
    const overflow = prompt.length - PROMPT_CHAR_BUDGET;
    const action = sections[actionIndex];
    sections[actionIndex] = clampToBudget(action, Math.max(0, action.length - overflow));
    prompt = sections.filter(Boolean).join('\n');
    warnings.push(
      `prompt: la acción se recortó para caber en el techo de ${PROMPT_CHAR_BUDGET} caracteres; divide el creativo en escenas para usar todo el guion`,
    );
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
