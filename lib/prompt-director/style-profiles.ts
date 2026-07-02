// Perfiles de estilo visual (plan 2026-07-02): el estilo deja de ser una regex
// implícita (STYLIZED_RE) y prompts con vocabulario de render, y se vuelve un
// preset declarado. Cada perfil define los bloques de prompt por etapa:
// generación de activos (locación / hoja maestra), panel fresco del storyboard,
// look de video y bloque del planner. Fase 0 cablea ultra_realista como default
// (el comportamiento actual, corregido); Fase 1 añade el selector por campaña.
//
// Por qué "photograph" y no "photorealistic": en datos de entrenamiento
// "photorealistic"/"cinematic" etiquetan renders CG que imitan fotos — pedirlos
// empuja al look de IA. El lenguaje de captura (cámara, lente, sombras de
// contacto, desgaste) es el que etiqueta fotos reales.
//
// OJO: ningún bloque puede usar términos de la lista antislop (antislop.ts);
// el test lo verifica con stripSlop.

export type VisualStyle = 'ultra_realista' | 'fantasia' | 'animado' | 'custom';

export type StyleProfile = {
  slug: VisualStyle;
  // Bloque de estética/captura para la imagen MAESTRA de una locación.
  assetLocation: string;
  // Ídem para la hoja maestra de personaje.
  assetCharacter: string;
  // Cláusula de estilo del panel FRESCO del storyboard (empieza con espacio).
  panel: string;
  // Look base del encabezado del video (compileSeedance).
  video: string;
  // Bloque en español para el SYSTEM del matcher/planner ('' = nada extra).
  planner: string;
  // false = el estilo permite doblar la física (fantasía): apaga las cláusulas
  // de coherencia física en panel, edición y planner.
  groundedPhysics: boolean;
};

// Física del mundo para prompts de IMAGEN (panel fresco, panel encadenado,
// refinado sandwich). Empieza con espacio (concatenable). Es de ANCLAJE, no de
// re-render: compatible con las ramas de edición donde el re-render está vetado.
export const WORLD_COHERENCE_CLAUSE =
  ' Physical coherence: every object rests on, hangs from or is held by something plausible — a framed picture hangs on a wall or stands on a shelf or easel, it never floats. Objects in contact cast soft grounded shadows, and all light comes from believable, consistent sources.';

// Bloque en español para el SYSTEM del matcher: los scenePrompt nacen con los
// objetos anclados, en vez de corregirlo después en el panel.
export const PLANNER_PHYSICS_BLOCK =
  '\nFÍSICA Y COHERENCIA DEL MUNDO: en cada scenePrompt los objetos están físicamente anclados — apoyados, colgados o sostenidos por algo plausible (un cuadro cuelga de la pared o descansa en una repisa o caballete; nunca flota). La escena obedece la gravedad y la luz viene de fuentes creíbles. Solo rompe la física si la idea o el formato lo piden explícitamente, y en ese caso decláralo en el scenePrompt.';

const ULTRA_REALISTA: StyleProfile = {
  slug: 'ultra_realista',
  assetLocation:
    'The image is a real photograph of the place, captured on location with a full-frame camera and a 35mm lens: believable ambient light with soft contact shadows, true-to-life colors and dynamic range, honest materials showing subtle everyday wear, and natural lived-in detail kept plausible. Documentary framing with slight natural imperfection — a real place, not a staged showroom and not a computer-generated render.',
  assetCharacter:
    'The image is a real unretouched photograph of the person, taken with a full-frame camera and an 85mm portrait lens: natural skin with visible pores and fine texture, true-to-life eyes and hair, and lifelike light on the face — a photographed human being, not a computer-generated render.',
  panel:
    ' Render the whole scene as a real photograph: believable ambient light with soft contact shadows, true-to-life colors, and honest materials with natural texture and subtle wear — a captured moment, not a computer-generated render.',
  // Contrato actual del compiler de Seedance (no cambiar en Fase 0).
  video: 'ultra realistic, filmic color grading',
  planner: '',
  groundedPhysics: true,
};

const FANTASIA: StyleProfile = {
  slug: 'fantasia',
  assetLocation:
    'The image is a scene from a rich fantasy world: painterly light, evocative atmosphere, imaginative architecture and materials that follow the internal logic of that world.',
  assetCharacter:
    'The image is a character portrait from a rich fantasy world: painterly light, evocative atmosphere, imaginative wardrobe consistent with that world.',
  panel:
    ' Render the scene as part of a rich fantasy world: painterly light, evocative atmosphere, imaginative but internally consistent — keep the same fantasy look across shots.',
  video: 'a rich fantasy look with painterly light, filmic color grading',
  planner:
    '\nESTILO DE LA CAMPAÑA: FANTASÍA. Las escenas pueden doblar la física y la lógica del mundo real cuando sirva a la idea; cuando lo hagan, descríbelo explícito en el scenePrompt.',
  groundedPhysics: false,
};

const ANIMADO: StyleProfile = {
  slug: 'animado',
  assetLocation:
    'The image is a frame from a polished 3D animated film: clean stylized shapes, soft global illumination, expressive color, appealing simplified detail.',
  assetCharacter:
    'The image is a character design frame from a polished 3D animated film: appealing stylized proportions, expressive face, clean shapes, soft even lighting.',
  panel:
    ' Render the scene as a frame from a polished 3D animated film: clean stylized shapes, soft global illumination, expressive color — keep the same animation style across shots.',
  video: 'a polished 3D animation look, expressive color',
  planner:
    '\nESTILO DE LA CAMPAÑA: ANIMADO (película de animación 3D). Escribe las escenas pensadas para ese look; la física sigue siendo creíble salvo un gag deliberado.',
  groundedPhysics: true,
};

// El estilo custom nace del texto del usuario: cada bloque lo cita tal cual.
// La física queda anclada (si el usuario quiere física libre, que elija fantasía
// o lo pida explícito en sus ideas — el planner lo respeta).
function customProfile(text: string): StyleProfile {
  const t = text.trim().replace(/\.+$/, '');
  return {
    slug: 'custom',
    assetLocation: `Visual style of the image: ${t}.`,
    assetCharacter: `Visual style of the image: ${t}.`,
    panel: ` Visual style of the whole scene, consistent across shots: ${t}.`,
    video: t,
    planner: `\nESTILO DE LA CAMPAÑA (definido por el usuario): ${t}. Escribe cada scenePrompt coherente con ese estilo.`,
    groundedPhysics: true,
  };
}

// Fase 1: fantasia/animado son presets fijos; custom nace del texto del
// usuario (customText). Sin texto (o solo espacios), custom cae al default.
export function getStyleProfile(style?: string | null, customText?: string | null): StyleProfile {
  switch (style) {
    case 'fantasia':
      return FANTASIA;
    case 'animado':
      return ANIMADO;
    case 'custom':
      return customText?.trim() ? customProfile(customText) : ULTRA_REALISTA;
    default:
      return ULTRA_REALISTA;
  }
}

// Bloques del planner listos para apendear a un SYSTEM prompt de autoría de
// escenas (matcher y asistente de refinado comparten esta política): el bloque
// de estilo del perfil + la física del mundo gateada por groundedPhysics.
// Empieza con '\n' (ambos bloques lo traen) o es '' (ultra_realista sin física
// no existe: el default siempre emite al menos la física).
export function plannerStyleBlocks(style?: string | null, customText?: string | null): string {
  const profile = getStyleProfile(style, customText);
  return `${profile.planner}${profile.groundedPhysics ? PLANNER_PHYSICS_BLOCK : ''}`;
}
