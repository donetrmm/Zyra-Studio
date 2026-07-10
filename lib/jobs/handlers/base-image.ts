import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ImageReference } from '@/lib/providers/types';
import { downloadOutputBuffer } from '@/lib/supabase/storage';

// Resuelve el generation padre (la "imagen de trabajo" de la sesión) a un buffer
// para editar en contexto. Devuelve null (no lanza) si el padre no existe, es de
// otro workspace, o aún no tiene output — en esos casos el turno degrada a
// texto-a-imagen en vez de tirar la generación. Sí lanza si la descarga del
// binario falla (mismo criterio que resolveReferenceBuffers: un objeto de Storage
// que debería existir y no baja es un fallo real → fail + refund aguas arriba).
export async function resolveBaseImage(
  workspaceId: string,
  parentGenerationId: string,
): Promise<ImageReference | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('generations')
    .select('output_url, workspace_id')
    .eq('id', parentGenerationId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.workspace_id !== workspaceId) return null;
  const path = (data.output_url as string | null) ?? null;
  if (!path) return null;
  const { buffer, mimeType } = await downloadOutputBuffer(path);
  return { buffer, mimeType };
}
