// Payload autocontenido que el server action del storyboard guarda en
// generations.params.storyboard para que el worker reconstruya la llamada a Nano
// solo desde la fila. Sin IO: el worker descarga las imagenes por path. Puro.

export type StoryboardPrevTurnRef = {
  imagePath: string; // path en el bucket outputs (safe_base 4:5 o el output 9:16 legacy)
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
};

export type BuildStoryboardJobPayloadArgs = {
  campaignItemId: string;
  campaignId: string;
  genAspect: string;
  strict: boolean;
  referencePaths: string[];
  chatRefPaths: string[];
  prevTurn: StoryboardPrevTurnRef | null;
};

export function buildStoryboardJobPayload(args: BuildStoryboardJobPayloadArgs): StoryboardJobPayload {
  return {
    campaignItemId: args.campaignItemId,
    campaignId: args.campaignId,
    genAspect: args.genAspect,
    strict: args.strict,
    conversational: args.prevTurn !== null,
    referencePaths: args.referencePaths,
    chatRefPaths: args.chatRefPaths,
    prevTurn: args.prevTurn,
  };
}
