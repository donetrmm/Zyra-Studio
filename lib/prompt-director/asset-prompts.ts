// Prompts de generación de ACTIVOS: imagen maestra de locación y hoja maestra
// de personaje. Antes vivían hardcodeados en los componentes cliente
// (LocationsPage/CastPage) con vocabulario de render ("photorealistic",
// "cinematic", "set") que producía el look de IA. El bloque de estética ahora
// sale del perfil de estilo — y como los paneles se ANCLAN a estas imágenes
// ("must match the provided location reference"), arreglarlo aquí corrige
// también lo que se hereda río abajo.

import { getStyleProfile, type VisualStyle } from './style-profiles';

// La locación es el ESCENARIO de una escena: un lugar listo para que ocurra
// algo, con espacio libre en primer plano para colocar sujetos y producto.
// Sin personas ni texto. FLUX sirve aquí: se crea desde texto, sin una
// referencia que preservar.
export function buildLocationPrompt(description: string, style?: VisualStyle): string {
  const profile = getStyleProfile(style);
  return (
    `Establishing shot of a location, ready for a scene to take place in it: ${description}. ` +
    'Eye-level camera, wide framing that leaves clear open foreground space where people and a ' +
    'product can be placed and act; the environment frames the action without crowding the center. ' +
    `${profile.assetLocation} Empty of people, no text, no watermark.`
  );
}

// Hoja maestra (doc V2 §4.4): retrato frontal neutro de una persona ficticia —
// los criterios de calidad de referencia que el Prompt Director espera (luz
// pareja, fondo liso, identidad estable). El perfil aporta el bloque de captura.
export function buildCharacterMasterPrompt(description: string, style?: VisualStyle): string {
  const profile = getStyleProfile(style);
  return (
    `Frontal head-and-shoulders portrait of a fictional person: ${description}. ` +
    'Neutral relaxed expression, looking straight at the camera, soft even studio lighting, ' +
    `plain light gray seamless background, sharp focus on the face. ${profile.assetCharacter} ` +
    'No text, no watermark.'
  );
}
