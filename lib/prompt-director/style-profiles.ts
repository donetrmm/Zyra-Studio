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

// Fase 0: solo existe el perfil realista; cualquier valor desconocido cae al
// default. Fase 1 añade fantasia/animado/custom (con segundo parámetro customText).
export function getStyleProfile(style?: string | null): StyleProfile {
  void style;
  return ULTRA_REALISTA;
}
