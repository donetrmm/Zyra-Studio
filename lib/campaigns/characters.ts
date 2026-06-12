import 'server-only';
import type { createClient } from '@/lib/supabase/server';

// Valida que todos los ids de personaje pertenezcan al workspace y tengan
// imagen utilizable (master o primera referencia). Devuelve los ids dedupeados
// en el orden recibido, o null si alguno no pasa (el caller responde
// validation_error). Regla 70-security: ownership en la action, RLS de respaldo.
export async function validateOwnedCharacters(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  ids: string[],
): Promise<string[] | null> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const { data } = await supabase
    .from('characters')
    .select('id, workspace_id, master_image_id, reference_image_ids')
    .in('id', unique);
  const valid = new Set(
    (data ?? [])
      .filter((c) => c.workspace_id === workspaceId)
      .filter((c) => c.master_image_id || ((c.reference_image_ids as string[]) ?? []).length > 0)
      .map((c) => c.id as string),
  );
  return unique.every((id) => valid.has(id)) ? unique : null;
}
