'use client';

import {
  createMediaReferenceAction,
  getUploadSignedUrlAction,
} from '@/server-actions/media-references';

export const REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
export const REFERENCE_ALLOWED_MIME = /^image\/(jpeg|png|webp|gif|bmp|tiff)$/i;

export type UploadedReference = {
  id: string;
  storagePath: string;
  previewUrl: string;
  filename: string;
};

export type UploadResult =
  | { ok: true; ref: UploadedReference }
  | { ok: false; message: string };

// Flow completo: validar → pedir signed URL → PUT → registrar media_reference.
// El previewUrl resultante es un object URL local del File (caller debe
// revocarlo con URL.revokeObjectURL cuando ya no use la ref).
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
