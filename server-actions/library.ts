'use server';

import 'server-only';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { ListLibrarySchema } from '@/lib/schemas/library';
import { fetchLibraryPage, type LibraryPage } from '@/lib/library/list';

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: 'validation_error' | 'internal_error'; message?: string };

// Listado paginado de la Biblioteca con filtros server-side. La primera
// página la sirve el Server Component; esta action cubre los cambios de
// filtro y el "cargar más" sin recargar la ruta.
export async function listLibraryAction(input: unknown): Promise<Result<LibraryPage>> {
  const parsed = ListLibrarySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();
  try {
    const page = await fetchLibraryPage(
      supabase,
      workspace.id,
      user.id,
      {
        type: parsed.data.type,
        favoritesOnly: parsed.data.favoritesOnly,
        includeStudio: parsed.data.includeStudio,
        q: parsed.data.q,
        sort: parsed.data.sort,
      },
      parsed.data.cursor,
    );
    return { ok: true, data: page };
  } catch (e) {
    return { ok: false, error: 'internal_error', message: (e as Error).message };
  }
}
