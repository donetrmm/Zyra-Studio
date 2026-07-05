// Prompts de generación de ACTIVOS: imagen maestra de locación y hoja maestra
// de personaje. Antes vivían hardcodeados en los componentes cliente
// (LocationsPage/CastPage) con vocabulario de render ("photorealistic",
// "cinematic", "set") que producía el look de IA. El bloque de estética ahora
// sale del perfil de estilo — y como los paneles se ANCLAN a estas imágenes
// ("must match the provided location reference"), arreglarlo aquí corrige
// también lo que se hereda río abajo.

import { getStyleProfile, type VisualStyle } from './style-profiles';
import { stripSlop } from './antislop';

// Sanea la DESCRIPCIÓN del usuario antes de componer el prompt del activo
// (auditoría BD 2026-07-04): descripciones pegadas de otras herramientas traen
// keyword soup ("8k, highly detailed") que la lista antislop veta en los
// compilers — pero los activos no pasan por compiler y entraban intactas.
// "photorealistic" se quita aparte: no está en la lista global (en prompts
// libres puede ser legítimo) pero en activos produce el look de render que el
// plan de estilos eliminó — y los activos anclan todo río abajo.
export function cleanAssetDescription(description: string): string {
  return stripSlop(description)
    .text.replace(/,?\s*\bphoto-?realistic\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// La locación es el ESCENARIO de una escena: un lugar listo para que ocurra
// algo, con espacio libre en primer plano para colocar sujetos y producto.
// Sin personas ni texto. FLUX sirve aquí: se crea desde texto, sin una
// referencia que preservar.
export function buildLocationPrompt(description: string, style?: VisualStyle, customText?: string): string {
  const profile = getStyleProfile(style, customText);
  return (
    `Establishing shot of a location, ready for a scene to take place in it: ${cleanAssetDescription(description)}. ` +
    'Eye-level camera, wide framing that leaves clear open foreground space where people and a ' +
    'product can be placed and act; the environment frames the action without crowding the center. ' +
    `${profile.assetLocation} Empty of people, no text, no watermark.`
  );
}

// Hoja maestra (doc V2 §4.4): retrato frontal neutro de una persona ficticia —
// los criterios de referencia que el Prompt Director espera (identidad estable,
// cara legible). El ENCUADRE y la expresión son contrato fijo; la luz, el fondo
// y la nitidez vienen del perfil (portraitSetting): hornearlos aquí como
// "estudio" contradecía el bloque smartphone de casero (bug 2026-07-04) y el
// modelo resolvía hacia el retrato pulido con look de IA.
export function buildCharacterMasterPrompt(description: string, style?: VisualStyle, customText?: string): string {
  const profile = getStyleProfile(style, customText);
  return (
    `Frontal head-and-shoulders portrait of a fictional person: ${cleanAssetDescription(description)}. ` +
    `Neutral relaxed expression, looking straight at the camera, ${profile.portraitSetting}. ` +
    `${profile.assetCharacter} No text, no watermark.`
  );
}
