// Contrato del Prompt Director (specs/v2/02-prompt-director.md, tarea 1).
// El director es ENSAMBLAJE DETERMINISTA: convierte brief + formato + Brand Kit
// + referencias en dirección de producción por modelo. No llama a ninguna API
// (el pulido LLM opcional vive aparte en lib/providers/prompt-enhancer.ts).

export type ReferenceRole =
  | 'product'        // fidelidad absoluta del producto
  | 'packaging'      // empaque (El Descubrimiento)
  | 'character'      // hoja maestra / ángulos del Cast
  | 'environment'    // entorno o escena de referencia
  | 'scale_map'      // esquema top-down: fija escala/posicion de objetos (P15)
  | 'style'          // dirección estética
  | 'camera_motion'  // video: replicar cámara/ritmo (plantillas vivas)
  | 'audio_rhythm'   // audio: mood y beats
  | 'start_frame';   // image2video: fotograma inicial

export type ReferenceKind = 'image' | 'video' | 'audio';

export type CompiledReference = {
  // Path en el bucket references/brand-assets; el handler lo firma al encolar.
  storagePath: string;
  kind: ReferenceKind;
  role: ReferenceRole;
  // Qué parte usar y qué excluir ("solo rostro y peinado, no la ropa").
  scope?: string;
};

// Dirección de un formato Zyra (fila de la tabla `formats`, no hardcodear).
export type FormatDirection = {
  slug: string;
  name: string;
  register: string;
  cameraStyle: string;
  pacing: string;
  requiredRefs: Array<'product' | 'character' | 'packaging'>;
  defaultDurationS: number;
  defaultAudio: boolean;
};

export type ProductInventory = {
  name: string;
  // Solo lo que el Brand Kit / brief declara. NUNCA inventar atributos.
  category?: string;
  visualDetails?: string;   // "frosted glass bottle, gold pump, navy label"
  palette?: string[];
  variants?: string[];
  // Tamaño físico declarado por el usuario (opcional). Solo productos con tamaño
  // relevante (cuadro, mueble) lo llenan. Ancla la proporción contra el personaje
  // en el storyboard. Ausente = sin ancla de escala (cero cambio).
  heightCm?: number;
  widthCm?: number;
  imagePaths: string[];        // multi-ángulo del Brand Kit
  // AM: descripcion de uso por imagen (path -> "three-quarter view"). El compiler
  // la cita junto a la referencia. Opcional; ausente = cita sin uso.
  imageUsages?: Record<string, string>;
  packagingImagePaths?: string[];
};

export type CharacterInventory = {
  name: string;
  // Apariencia, vestuario y manera de actuar. Sin marcadores de edad
  // (inventory.ts los detecta y limpia).
  description: string;
  masterImagePath: string;
  angleImagePaths?: string[];
  // P05: label del estado fisico activo en ESTA escena (sudado/mojado/...). Cuando
  // existe, masterImagePath es la variante de estado y el compiler usa su vestuario.
  stateLabel?: string;
};

export type DirectorContext = {
  format?: FormatDirection;
  product?: ProductInventory;
  // Personajes del creativo, máx 3. Orden = orden de referencias (el primero
  // es el principal). Presupuesto de ángulos: 1→2, 2→1, 3→0 (tope 9 imágenes).
  characters?: CharacterInventory[];
  // Referencias extra del refinado (campaign_items.reference_ids resueltos):
  // rol environment, al final de la prioridad.
  extraImagePaths?: string[];
  // Locación de la secuencia: su imagen se re-ancla como referencia environment
  // en cada clip y su descripción refuerza el "dónde". Antes de extraImagePaths
  // en prioridad. v1 usa la imagen master (imagePaths[0..]) y, si existe, un mapa de escala top-down (scaleMap).
  // FALLBACK soportado (Q-04): imagePaths puede venir VACÍO (locación solo-texto).
  // En ese caso no hay referencia environment que re-anclar y la descripción
  // ancla el "dónde" (línea `Location: ...`). NO exigir imagen — es un fallback
  // intencional; con imagen la consistencia visual entre clips es mejor.
  location?: {
    name?: string;
    description?: string;
    imagePaths: string[];
    // P15: esquema top-down que fija escala/posicion; se cita como rol scale_map
    // y se re-ancla por clip (igual que imagePaths). `notes` = proporciones en texto.
    scaleMap?: { path: string; notes?: string };
  };
  // Escena elegida (de scene_library o libre). fragment va al prompt.
  scene?: { name?: string; fragment: string };
  // Plantilla viva: video ganador como referencia de estructura/cámara/ritmo.
  templateVideoPath?: string;
  audioRefPath?: string;
  // Idioma del diálogo/voz hablada. El prompt va en inglés, pero el modelo
  // habla en el idioma del prompt salvo directiva explícita. Default 'es'.
  language?: 'es' | 'en';
  // Guías creativas opt-in de la campaña (spec 2026-06-29). Gatean cláusulas
  // deterministas de encuadre. Ausente = ninguna.
  guidelines?: import('@/lib/campaigns/guidelines').CreativeGuidelines;
};

export type CompileRequest = {
  modelSlug: string;
  // La acción de la escena (del plan de campaña). El director la enmarca,
  // no la reescribe.
  scenePrompt: string;
  durationS?: number;
  aspectRatio?: string;
  resolution?: string;
  generateAudio?: boolean;
  seed?: number;
  // El beat es la apertura del creativo (scene_index 0 o clip único). Habilita
  // la guía hookProductHero. Default undefined/false.
  isOpeningBeat?: boolean;
};

export type CompiledPrompt = {
  modelSlug: string;
  prompt: string;
  // Params listos para el job (el orquestador los mapea al handler).
  params: Record<string, unknown>;
  // Ordenadas: el orden define la numeración @Image1.. en Seedance.
  references: CompiledReference[];
  warnings: string[];
};

export type CompileResult =
  | { ok: true; compiled: CompiledPrompt }
  | { ok: false; errors: string[]; warnings: string[] };
