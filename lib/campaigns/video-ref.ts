import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { downloadOutputBuffer } from '@/lib/supabase/storage';
import { REFERENCES_BUCKET } from '@/lib/supabase/storage';

// Copia el output de una generación de video al bucket references para poder
// usarlo como referencia @Video1 (plantillas vivas, extensión, reemplazo de
// personaje). Necesario porque el handler de Seedance firma SOLO el bucket
// references; outputs tiene policies distintas (mismo patrón que
// addGenerationAsReferenceAction usa para imágenes).
//
// Límite de Seedance para videos de referencia: ≤15 s, 480p-720p, <50 MB —
// los outputs propios (draft 480p / final 720p, 4-15 s) siempre cumplen.
export async function copyOutputVideoToReferences(params: {
  workspaceId: string;
  userId: string;
  outputPath: string;
  label: string; // 'template' | 'variant' — solo para el nombre del archivo
}): Promise<string> {
  const { buffer, mimeType } = await downloadOutputBuffer(params.outputPath);
  if (!mimeType.includes('mp4') && !mimeType.includes('video')) {
    throw new Error(`el output no es video (${mimeType})`);
  }
  const path = `${params.workspaceId}/${params.userId}/${params.label}-${crypto.randomUUID()}.mp4`;
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(REFERENCES_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: false });
  if (error) throw new Error(`copia de video a references: ${error.message}`);
  return path;
}
