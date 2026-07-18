import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { ProviderError, type ImageReference } from '@/lib/providers/types';
import { downloadReferenceBuffer } from '@/lib/supabase/storage';

// Resuelve reference_ids (uuids de media_references) a buffers descargados,
// para el turno de estudio (image-turn.ts). Espeja la seguridad de
// loadReferences (server-actions/generations.ts): filtra por workspace_id y
// type='image' antes de bajar el binario, pero con admin client porque el
// worker no tiene sesión de usuario. Reusa downloadReferenceBuffer (mismo
// helper de storage que ya usa el flujo de storyboard) — no duplica la
// descarga.
//
// Vive en su propio módulo (no en nano-banana.ts) para no crear un ciclo de
// imports: nano-banana.ts enruta turnos de estudio a image-turn.ts, e
// image-turn.ts necesita este helper — si viviera en nano-banana.ts, TS no
// puede inferir los tipos de la dependencia circular resultante (falla el
// typecheck con "Expected 0-1 arguments" en la llamada, no con un error de
// ciclo explícito).
export async function resolveReferenceBuffers(
  workspaceId: string,
  referenceIds: string[],
): Promise<ImageReference[]> {
  if (referenceIds.length === 0) return [];
  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from('media_references')
    .select('id, workspace_id, storage_url, type')
    .in('id', referenceIds);
  if (error) {
    throw new ProviderError(`no se pudieron cargar las referencias: ${error.message}`, 'unknown', false);
  }
  const pathById = new Map<string, string>();
  for (const row of (rows ?? []) as Array<{
    id: string;
    workspace_id: string;
    storage_url: string;
    type: string;
  }>) {
    if (row.workspace_id === workspaceId && row.type === 'image') {
      pathById.set(row.id, row.storage_url);
    }
  }
  const buffers: ImageReference[] = [];
  for (const id of referenceIds) {
    const path = pathById.get(id);
    if (!path) continue; // ref ajena al workspace o no-imagen: se omite, no se tira el turno
    const { buffer, mimeType } = await downloadReferenceBuffer(path);
    buffers.push({ buffer, mimeType });
  }
  return buffers;
}
