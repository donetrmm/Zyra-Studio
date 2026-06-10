// Dirección por formato (specs/v2/02 tarea 3): traduce la fila de `formats`
// (registro, cámara, ritmo, required_refs) al esqueleto de dirección del
// prompt. Los formatos vienen de la base — nada hardcodeado por slug.

import type { DirectorContext, FormatDirection } from './types';

// Mapea la fila snake_case de la tabla `formats` al tipo del director.
export function fromFormatRow(row: {
  slug: string;
  name: string;
  register: string | null;
  camera_style: string | null;
  pacing: string | null;
  required_refs: string[];
  default_duration_s: number;
  default_audio: boolean;
}): FormatDirection {
  return {
    slug: row.slug,
    name: row.name,
    register: row.register ?? '',
    cameraStyle: row.camera_style ?? '',
    pacing: row.pacing ?? '',
    requiredRefs: row.required_refs.filter(
      (r): r is 'product' | 'character' | 'packaging' =>
        r === 'product' || r === 'character' || r === 'packaging',
    ),
    defaultDurationS: row.default_duration_s,
    defaultAudio: row.default_audio,
  };
}

// Verifica que el contexto trae las referencias que el formato exige.
// Falta obligatoria = bloqueo (el orquestador muestra mensaje accionable).
export function resolveRequiredRefs(
  format: FormatDirection,
  context: DirectorContext,
): { missing: string[] } {
  const missing: string[] = [];
  for (const ref of format.requiredRefs) {
    if (ref === 'product' && !(context.product?.imagePaths.length)) {
      missing.push('product: el formato necesita imágenes del producto en el Brand Kit');
    }
    if (ref === 'character' && !context.character?.masterImagePath) {
      missing.push('character: el formato necesita la hoja maestra de un personaje del Cast');
    }
    if (ref === 'packaging' && !(context.product?.packagingImagePaths?.length)) {
      missing.push('packaging: el formato necesita imágenes del empaque en el Brand Kit');
    }
  }
  return { missing };
}

// Bloques de dirección que el compiler inserta en el prompt.
export function directionFor(format: FormatDirection): {
  framing: string;
  register: string;
  pacing: string;
} {
  return {
    framing: format.cameraStyle ? `Camera: ${format.cameraStyle}.` : '',
    register: format.register ? `Register: ${format.register}.` : '',
    pacing: format.pacing ? `Pacing: ${format.pacing}.` : '',
  };
}
