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
