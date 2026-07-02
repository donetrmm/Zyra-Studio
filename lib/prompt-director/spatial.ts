// P13: detector puro de bloqueo geo-espacial. Una escena multi-sujeto sin
// marcadores de posición/orientación deja al modelo libre de reubicar a los
// sujetos entre cortes. Lenient por diseño: cualquier marcador cuenta como
// "tiene bloqueo" (preferimos sub-avisar a sobre-avisar). El scenePrompt
// siempre va en inglés, así que los marcadores son en inglés.
const SPATIAL_RE =
  /\b(left|right|fore-?ground|back-?ground|mid-?ground|behind|in front of|next to|beside|between|opposite|across from|far side|near side|cent(?:er|re)|facing|faces|turned toward|camera-(?:left|right)|met(?:er|re)s?|feet|apart|arm'?s length)\b/i;

export function hasSpatialBlocking(text: string): boolean {
  return SPATIAL_RE.test(text);
}

// Integración personaje-locación (spec 2026-07-02): la hoja maestra del Cast
// viene de estudio (luz pareja, fondo liso); sin esta cláusula el modelo
// "pega" a la persona sobre el fondo con luz y sombras incoherentes (efecto
// photoshop). Redactada NEUTRAL al estilo: la coherencia de luz aplica igual
// en animado/fantasía. SOLO generación fresca — nunca ramas de edición.
export const SCENE_INTEGRATION_CLAUSE =
  "Integrate the people naturally into the location: they are lit by the scene's existing light sources — same direction, color temperature and softness — they cast soft contact shadows on the surfaces they touch, and they match the scene's perspective, depth of field and overall color grade; no one looks cut out or pasted onto the background.";
