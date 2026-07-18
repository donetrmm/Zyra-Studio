import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { trimAudio } from './video-frame';

// Sample-pipeline de voz por personaje (specs/v2/14, pendiente conocido):
// Seedance acepta audios de referencia de ≤15s combinados
// (docs/modelos/06-seedance-2.md §refs), pero las muestras de voz se suben
// largas (20-60s) porque el clonado de ElevenLabs las quiere así. Sin recorte,
// todo clip R2V con @audio1 muere en el proveedor con DurationTooLong
// (bug 2026-07-14, campaña "Del celular a la pared V1").
//
// El original NUNCA se toca: se deriva una variante recortada una sola vez y
// se cachea junto a él en el mismo bucket.

const VOICE_SAMPLES_BUCKET = 'voice-samples';
// 8s: dentro del sweet spot de Seedance para referencia de timbre (3-8s,
// specs/v2/14) y muy por debajo del tope duro de 15s combinados. Pendiente del
// pipeline fino: quitar silencios y normalizar loudness antes de recortar.
export const SEEDANCE_VOICE_TRIM_S = 8;

// Path determinístico de la variante — sirve de clave de caché. Idempotente:
// pasar una variante devuelve la misma (evita sufijos anidados si un path
// derivado se re-procesa).
export function seedanceVoiceVariantPath(path: string): string {
  const suffix = `.seedance-${SEEDANCE_VOICE_TRIM_S}s.mp3`;
  if (path.endsWith(suffix)) return path;
  return `${path.replace(/\.[a-z0-9]+$/i, '')}${suffix}`;
}

// Devuelve el path (bucket voice-samples) de la variante ≤15s de la muestra,
// derivándola con ffmpeg la primera vez. Lanza si no puede derivarla; el
// caller decide si degrada al original (que fallaría en el proveedor, pero con
// samples ya cortos es la opción correcta).
export async function ensureSeedanceVoiceSamplePath(path: string): Promise<string> {
  const derived = seedanceVoiceVariantPath(path);
  if (derived === path) return path; // ya es una variante
  const admin = createAdminClient();

  // Cache hit: listar por nombre exacto en la carpeta (sin descargar el archivo).
  const dir = derived.split('/').slice(0, -1).join('/');
  const base = derived.split('/').pop()!;
  const { data: entries } = await admin.storage
    .from(VOICE_SAMPLES_BUCKET)
    .list(dir, { search: base, limit: 1 });
  if ((entries ?? []).some((e) => e.name === base)) return derived;

  const { data: original, error } = await admin.storage.from(VOICE_SAMPLES_BUCKET).download(path);
  if (error || !original) {
    throw new Error(`muestra de voz no disponible (${path}): ${error?.message ?? 'sin datos'}`);
  }
  const trimmed = await trimAudio(Buffer.from(await original.arrayBuffer()), SEEDANCE_VOICE_TRIM_S);
  const { error: upErr } = await admin.storage
    .from(VOICE_SAMPLES_BUCKET)
    .upload(derived, trimmed, { contentType: 'audio/mpeg', upsert: true });
  if (upErr) throw new Error(`no se pudo subir la variante recortada: ${upErr.message}`);
  return derived;
}
