'use server';

import 'server-only';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { downloadReferenceBuffer } from '@/lib/supabase/storage';
import { averageHash, hammingDistance, NEARLY_IDENTICAL_MAX_DISTANCE } from '@/lib/images/similarity';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

// Resuelve el storagePath de imágenes ya guardadas (validando ownership) para
// que el wizard pueda EDITARLAS con Nano Banana (necesita {id, storagePath}).
// Lo usa el flujo "Mejorar con IA" del Brand Kit, que lee las imágenes del kit.
export async function getReferencePathsAction(ids: unknown): Promise<Result<Record<string, string>>> {
  const parsed = z.array(z.string().uuid()).max(8).safeParse(ids);
  if (!parsed.success) return { ok: false, error: 'validation_error' };
  if (parsed.data.length === 0) return { ok: true, data: {} };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data } = await supabase
    .from('media_references')
    .select('id, storage_url, workspace_id')
    .in('id', parsed.data);
  const out: Record<string, string> = {};
  for (const r of data ?? []) {
    if (r.workspace_id === workspace.id && r.storage_url) out[r.id as string] = r.storage_url as string;
  }
  return { ok: true, data: out };
}

// Compara dos referencias por hash perceptual para detectar que el proveedor
// devolvio una imagen casi intacta (echo) en vez de una vista nueva — p. ej. la
// "vista 3/4" del producto que a veces no rota. Devuelve la distancia y si cae
// bajo el umbral de "casi identica".
export async function compareReferencesAction(
  input: unknown,
): Promise<Result<{ distance: number; nearlyIdentical: boolean }>> {
  const parsed = z.object({ a: z.string().uuid(), b: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error' };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data } = await supabase
    .from('media_references')
    .select('id, storage_url, workspace_id')
    .in('id', [parsed.data.a, parsed.data.b]);
  const paths: Record<string, string> = {};
  for (const r of data ?? []) {
    if (r.workspace_id === workspace.id && r.storage_url) paths[r.id as string] = r.storage_url as string;
  }
  const pathA = paths[parsed.data.a];
  const pathB = paths[parsed.data.b];
  if (!pathA || !pathB) return { ok: false, error: 'not_found', message: 'Imagen no encontrada' };
  try {
    const [a, b] = await Promise.all([downloadReferenceBuffer(pathA), downloadReferenceBuffer(pathB)]);
    const [ha, hb] = await Promise.all([averageHash(a.buffer), averageHash(b.buffer)]);
    const distance = hammingDistance(ha, hb);
    return { ok: true, data: { distance, nearlyIdentical: distance <= NEARLY_IDENTICAL_MAX_DISTANCE } };
  } catch (e) {
    return { ok: false, error: 'provider_error', message: (e as Error).message };
  }
}
