import 'server-only';
import { createAdminClient } from './admin';
import { createClient } from './server';

export const REFERENCES_BUCKET = 'references';
export const OUTPUTS_BUCKET = 'outputs';
export const THUMBNAILS_BUCKET = 'thumbnails';
export const VOICE_SAMPLES_BUCKET = 'voice-samples';

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 24h

export async function uploadOutput(
  workspaceId: string,
  generationId: string,
  buffer: Buffer,
  mimeType: string,
  extension: string,
): Promise<string> {
  const admin = createAdminClient();
  const path = `${workspaceId}/${generationId}/output.${extension}`;
  const { error } = await admin.storage
    .from(OUTPUTS_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: true });
  if (error) throw new Error(`upload output failed: ${error.message}`);
  return path;
}

// Sube la BASE 4:5 de Nano de un panel estricto (antes del expand a 9:16) al bucket
// outputs, en un path secundario de la misma generacion. Sirve para ENCADENAR: el
// thought_signature guardado corresponde a esta base, no al 9:16 final de FLUX, asi
// que el siguiente beat debe replayar ESTA imagen (no el output) para que la firma
// del chat de Gemini calce. Se baja con downloadOutputBuffer (mismo bucket).
export async function uploadSafeBase(
  workspaceId: string,
  generationId: string,
  buffer: Buffer,
  mimeType: string,
  extension: string,
): Promise<string> {
  const admin = createAdminClient();
  const path = `${workspaceId}/${generationId}/safe-base.${extension}`;
  const { error } = await admin.storage
    .from(OUTPUTS_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: true });
  if (error) throw new Error(`upload safe base failed: ${error.message}`);
  return path;
}

// Persiste el thought_signature de Gemini (~6-9MB) como objeto de Storage y
// devuelve su path interno. NUNCA guardarlo en columnas de la BD (params /
// provider_payload): infla la fila a 8MB+, complete_generation muere por
// statement timeout en instancias chicas y el broadcast de Realtime descarta
// records >1MB. La firma se mueve siempre por referencia (path).
export async function uploadThoughtSignature(
  workspaceId: string,
  generationId: string,
  signature: string,
): Promise<string> {
  const admin = createAdminClient();
  const path = `${workspaceId}/${generationId}/thought-signature.txt`;
  const { error } = await admin.storage
    .from(OUTPUTS_BUCKET)
    .upload(path, Buffer.from(signature, 'utf8'), { contentType: 'text/plain', upsert: true });
  if (error) throw new Error(`upload thought signature failed: ${error.message}`);
  return path;
}

// Sube una imagen al bucket de referencias (p. ej. el último fotograma heredado
// en el encadenado de secuencias) y devuelve su path interno. `key` es la ruta
// dentro del workspace (sin el prefijo de workspace).
export async function uploadReference(
  workspaceId: string,
  key: string,
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  const admin = createAdminClient();
  const path = `${workspaceId}/${key}`;
  const { error } = await admin.storage
    .from(REFERENCES_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: true });
  if (error) throw new Error(`upload reference failed: ${error.message}`);
  return path;
}

export async function uploadThumbnail(
  workspaceId: string,
  generationId: string,
  buffer: Buffer,
): Promise<string> {
  const admin = createAdminClient();
  const path = `${workspaceId}/${generationId}/thumb.jpg`;
  const { error } = await admin.storage
    .from(THUMBNAILS_BUCKET)
    .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(`upload thumbnail failed: ${error.message}`);
  return path;
}

export function publicThumbnailUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${base}/storage/v1/object/public/${THUMBNAILS_BUCKET}/${path}`;
}

export async function signedOutputUrl(path: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(OUTPUTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) throw new Error(`sign output failed: ${error?.message ?? 'unknown'}`);
  return data.signedUrl;
}

export async function signedOutputUrlAdmin(path: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(OUTPUTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) throw new Error(`sign output (admin) failed: ${error?.message ?? 'unknown'}`);
  return data.signedUrl;
}

export async function signedReferenceUrl(path: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(REFERENCES_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) throw new Error(`sign reference failed: ${error?.message ?? 'unknown'}`);
  return data.signedUrl;
}

export async function signedReferenceUrlAdmin(path: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(REFERENCES_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) throw new Error(`sign reference (admin) failed: ${error?.message ?? 'unknown'}`);
  return data.signedUrl;
}

// Voces CARGADAS por el usuario (no clonadas): audio subido tal cual. El path
// empieza con el userId — la RLS del bucket voice-samples (013) exige
// foldername[1] = auth.uid(). Sube con admin (el worker/action no siempre tiene
// sesión de storage), lee con la sesión del usuario (signedVoiceSampleUrl).
export async function uploadVoiceSample(
  userId: string,
  key: string,
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  const admin = createAdminClient();
  const path = `${userId}/${key}`;
  const { error } = await admin.storage
    .from(VOICE_SAMPLES_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: true });
  if (error) throw new Error(`upload voice sample failed: ${error.message}`);
  return path;
}

export async function signedVoiceSampleUrl(path: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(VOICE_SAMPLES_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) throw new Error(`sign voice sample failed: ${error?.message ?? 'unknown'}`);
  return data.signedUrl;
}

// Para el worker (sin sesión de usuario): firma la voz de referencia del clip
// (@audio1) contra su bucket real. Espejo de signedReferenceUrlAdmin.
export async function signedVoiceSampleUrlAdmin(path: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(VOICE_SAMPLES_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) throw new Error(`sign voice sample (admin) failed: ${error?.message ?? 'unknown'}`);
  return data.signedUrl;
}

export async function deleteVoiceSample(path: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(VOICE_SAMPLES_BUCKET).remove([path]);
  if (error) throw new Error(`delete voice sample failed: ${error.message}`);
}

export async function downloadReferenceBuffer(path: string): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(REFERENCES_BUCKET).download(path);
  if (error || !data) throw new Error(`download reference failed: ${error?.message ?? 'unknown'}`);
  const arrayBuf = await data.arrayBuffer();
  return { buffer: Buffer.from(arrayBuf), mimeType: data.type || 'image/jpeg' };
}

export async function downloadOutputBuffer(path: string): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(OUTPUTS_BUCKET).download(path);
  if (error || !data) throw new Error(`download output failed: ${error?.message ?? 'unknown'}`);
  const arrayBuf = await data.arrayBuffer();
  return { buffer: Buffer.from(arrayBuf), mimeType: data.type || 'image/jpeg' };
}

// Promueve un output ya generado (bucket outputs) a una media_reference reusable
// (bucket references): copia el binario y crea la fila media_references type
// 'image'. Devuelve el id de la nueva media_reference. Usado por el storyboard:
// el panel debe ser una referencia (para el video) y base de la siguiente edición.
export async function promoteOutputToReference(
  workspaceId: string,
  userId: string,
  outputPath: string,
  sourceGenerationId: string,
): Promise<string> {
  const { buffer, mimeType } = await downloadOutputBuffer(outputPath);
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const key = `storyboard/${crypto.randomUUID()}.${ext}`;
  const path = await uploadReference(workspaceId, key, buffer, mimeType);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('media_references')
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      type: 'image',
      storage_url: path,
      source: 'generation',
      source_generation_id: sourceGenerationId,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`promote reference failed: ${error?.message ?? 'no row'}`);
  return data.id as string;
}

export async function createReferenceUploadUrl(
  workspaceId: string,
  userId: string,
  filename: string,
): Promise<{ path: string; signedUrl: string; token: string }> {
  const supabase = await createClient();
  const cleanName = filename.replace(/[^\w.\-]+/g, '_');
  const path = `${workspaceId}/${userId}/${crypto.randomUUID()}-${cleanName}`;
  const { data, error } = await supabase.storage
    .from(REFERENCES_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(`signed upload url failed: ${error?.message ?? 'unknown'}`);
  }
  return { path, signedUrl: data.signedUrl, token: data.token };
}
