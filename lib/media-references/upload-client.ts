'use client';

import {
  createMediaReferenceAction,
  getUploadSignedUrlAction,
} from '@/server-actions/media-references';

export const REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
export const REFERENCE_ALLOWED_MIME = /^image\/(jpeg|png|webp|gif|bmp|tiff)$/i;

// Tipos extra para las referencias multimodales de Seedance 2.0
// (límites del modelo: video <50 MB, audio <15 MB).
export const VIDEO_REF_MIME = /^video\/(mp4|quicktime)$/i;
export const AUDIO_REF_MIME = /^audio\/(mpeg|mp3|wav|x-wav)$/i;
export const VIDEO_REF_MAX_BYTES = 50 * 1024 * 1024;
export const AUDIO_REF_MAX_BYTES = 15 * 1024 * 1024;

export type ReferenceKind = 'image' | 'video' | 'audio';

export type UploadedReference = {
  id: string;
  storagePath: string;
  previewUrl: string;
  filename: string;
};

export type UploadResult =
  | { ok: true; ref: UploadedReference }
  | { ok: false; message: string };

export function referenceKindOf(file: File): ReferenceKind | null {
  if (REFERENCE_ALLOWED_MIME.test(file.type)) return 'image';
  if (VIDEO_REF_MIME.test(file.type)) return 'video';
  if (AUDIO_REF_MIME.test(file.type)) return 'audio';
  return null;
}

// Flow completo para cualquier tipo de referencia (imagen/video/audio):
// validar → pedir signed URL → PUT → registrar media_reference.
export async function uploadMediaReferenceFile(file: File): Promise<UploadResult> {
  const kind = referenceKindOf(file);
  if (!kind) {
    return { ok: false, message: `"${file.name}" no es un tipo soportado (imagen, mp4/mov, mp3/wav)` };
  }
  const maxBytes =
    kind === 'image' ? REFERENCE_MAX_BYTES : kind === 'video' ? VIDEO_REF_MAX_BYTES : AUDIO_REF_MAX_BYTES;
  if (file.size > maxBytes) {
    return { ok: false, message: `"${file.name}" supera ${Math.round(maxBytes / 1024 / 1024)} MB` };
  }

  const urlRes = await getUploadSignedUrlAction({
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
  if (!urlRes.ok) {
    return { ok: false, message: urlRes.message ?? 'No se pudo iniciar el upload' };
  }

  const putRes = await fetch(urlRes.data.signedUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });
  if (!putRes.ok) {
    return { ok: false, message: `Subida falló (${putRes.status})` };
  }

  const created = await createMediaReferenceAction({
    storagePath: urlRes.data.path,
    type: kind,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
  if (!created.ok) {
    return { ok: false, message: created.message ?? 'No se pudo registrar la referencia' };
  }

  return {
    ok: true,
    ref: {
      id: created.data.id,
      storagePath: urlRes.data.path,
      previewUrl: URL.createObjectURL(file),
      filename: file.name,
    },
  };
}

// Flow original solo-imagen (lo usan los formularios V1 y los uploaders de
// Brand Kit/Cast). Delegar mantendría el contrato, pero el mensaje de error
// específico de imagen se conserva aquí.
export async function uploadReferenceFile(file: File): Promise<UploadResult> {
  if (file.size > REFERENCE_MAX_BYTES) {
    return { ok: false, message: `"${file.name}" supera 10 MB` };
  }
  if (!REFERENCE_ALLOWED_MIME.test(file.type)) {
    return { ok: false, message: `"${file.name}" no es una imagen válida` };
  }

  const urlRes = await getUploadSignedUrlAction({
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
  if (!urlRes.ok) {
    return { ok: false, message: urlRes.message ?? 'No se pudo iniciar el upload' };
  }

  const putRes = await fetch(urlRes.data.signedUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });
  if (!putRes.ok) {
    return { ok: false, message: `Subida falló (${putRes.status})` };
  }

  const created = await createMediaReferenceAction({
    storagePath: urlRes.data.path,
    type: 'image',
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
  if (!created.ok) {
    return { ok: false, message: created.message ?? 'No se pudo registrar la referencia' };
  }

  return {
    ok: true,
    ref: {
      id: created.data.id,
      storagePath: urlRes.data.path,
      previewUrl: URL.createObjectURL(file),
      filename: file.name,
    },
  };
}
