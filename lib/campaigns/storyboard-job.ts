// Payload autocontenido que el server action del storyboard guarda en
// generations.params.storyboard para que el worker reconstruya la llamada a Nano
// solo desde la fila. Sin IO: el worker descarga las imagenes por path. Puro.

export type StoryboardPrevTurnRef = {
  imagePath: string; // path en el bucket outputs (safe_base 4:5 o el output 9:16 legacy)
  // Bucket del imagePath. Default 'outputs' (paneles generados); 'references'
  // cuando el panel actual es una subida manual (media_reference sin gen).
  bucket?: 'outputs' | 'references';
  // Gen de la que el worker lee provider_payload.thought_signature al momento del
  // job. La firma (~8MB) NUNCA se embebe aqui: este payload vive en generations.params,
  // que viaja en el broadcast de Realtime (max_record_bytes 1MB, migracion 050) y
  // engorda el SELECT del worker hasta hacerlo fallar. Referencia, no copia.
  sourceGenerationId?: string;
  // Solo lectura de compat: jobs encolados antes del cambio traian la firma inline.
  // NO escribir nunca; el worker la usa como fallback al drenar la cola vieja.
  thoughtSignature?: string;
  prompt: string;
};

export type StoryboardJobPayload = {
  campaignItemId: string;
  campaignId: string;
  genAspect: string; // '4:5' en estricto, si no el aspecto del item
  strict: boolean;
  conversational: boolean;
  referencePaths: string[]; // refs limpias (producto/personaje/locacion) por storage path
  chatRefPaths: string[]; // refs re-ancladas en chat (ya resueltas por flag); vacio si ninguna
  prevTurn: StoryboardPrevTurnRef | null;
  // Descripcion corta de la escena/locacion para anclar las bandas del expand
  // 9:16: el prompt neutro ("continua el fondo") dejaba a FLUX inventar
  // escenografia ajena a la locacion configurada. Opcional: sin locacion, el
  // expand sigue neutro.
  expandHint?: string;
};

export type BuildStoryboardJobPayloadArgs = {
  campaignItemId: string;
  campaignId: string;
  genAspect: string;
  strict: boolean;
  referencePaths: string[];
  chatRefPaths: string[];
  prevTurn: StoryboardPrevTurnRef | null;
  expandHint?: string;
};

// Tope del hint del expand: es un ancla de escenografia, no el prompt completo
// (el payload vive en params y debe quedarse chico).
const EXPAND_HINT_MAX = 280;

export function buildStoryboardJobPayload(args: BuildStoryboardJobPayloadArgs): StoryboardJobPayload {
  const hint = args.expandHint?.trim();
  return {
    campaignItemId: args.campaignItemId,
    campaignId: args.campaignId,
    genAspect: args.genAspect,
    strict: args.strict,
    conversational: args.prevTurn !== null,
    referencePaths: args.referencePaths,
    chatRefPaths: args.chatRefPaths,
    prevTurn: args.prevTurn,
    ...(hint ? { expandHint: hint.slice(0, EXPAND_HINT_MAX) } : {}),
  };
}
