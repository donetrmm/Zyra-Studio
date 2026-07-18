import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicThumbnailUrl } from '@/lib/supabase/storage';
import type { LibraryGeneration } from '@/components/library/LibraryView';

// Página de la Biblioteca: query compartida entre el Server Component
// (primera página) y listLibraryAction (filtros y "cargar más"). Un solo
// lugar define columnas, mapeo y paginación keyset — si divergen, la UI
// muestra cosas distintas al paginar que al cargar.

export const LIBRARY_PAGE_SIZE = 60;

export type LibraryCursor = { createdAt: string; id: string };

export type LibraryFilters = {
  type?: 'image' | 'video' | 'audio';
  favoritesOnly?: boolean;
  // Los turnos del estudio creativo viven en su galería de sesión; solo se
  // mezclan aquí bajo demanda (chip "Estudio").
  includeStudio?: boolean;
  q?: string;
  sort?: 'recent' | 'old';
};

export type LibraryPage = {
  items: LibraryGeneration[];
  hasMore: boolean;
  nextCursor: LibraryCursor | null;
  // Total con los filtros aplicados. Solo se calcula en la primera página
  // (count exact es una query extra); en "cargar más" viene null.
  total: number | null;
};

const COLUMNS =
  'id, type, provider, model_id, prompt, status, thumbnail_url, output_url, credits_charged, created_at, params, parent_generation_id, batch_id, batch_kind, campaign_id, quality_score, quality_flags, quality_summary';

// Escapa los caracteres reservados del sintaxis de filtros de PostgREST
// dentro de un patrón ilike (coma, paréntesis, comodines).
function escapeIlike(q: string): string {
  return q.replace(/[%_\\]/g, (m) => `\\${m}`).replace(/[(),]/g, ' ');
}

export async function fetchLibraryPage(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  filters: LibraryFilters,
  cursor: LibraryCursor | null,
): Promise<LibraryPage> {
  const sort = filters.sort ?? 'recent';
  const ascending = sort === 'old';

  // favoritesOnly: los favoritos son por usuario y acotados; resolver los ids
  // primero mantiene la query principal simple (y con RLS de generations).
  let favIds: string[] | null = null;
  if (filters.favoritesOnly) {
    const { data: favs } = await supabase
      .from('favorites')
      .select('generation_id')
      .eq('user_id', userId);
    favIds = (favs ?? []).map((f) => f.generation_id as string);
    if (favIds.length === 0) {
      return { items: [], hasMore: false, nextCursor: null, total: 0 };
    }
  }

  let query = supabase
    .from('generations')
    .select(COLUMNS, cursor ? {} : { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending })
    .order('id', { ascending })
    .limit(LIBRARY_PAGE_SIZE + 1);

  if (!filters.includeStudio) query = query.is('studio_session_id', null);
  if (filters.type) query = query.eq('type', filters.type);
  if (favIds) query = query.in('id', favIds);
  if (filters.q?.trim()) {
    const needle = escapeIlike(filters.q.trim());
    query = query.or(`prompt.ilike.*${needle}*,model_id.ilike.*${needle}*`);
  }
  if (cursor) {
    // Keyset (created_at, id): estable aunque haya timestamps repetidos
    // (los lotes de storyboard insertan varios paneles en el mismo instante).
    const op = ascending ? 'gt' : 'lt';
    query = query.or(
      `created_at.${op}.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.${op}.${cursor.id})`,
    );
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`library list: ${error.message}`);

  const rows = data ?? [];
  const hasMore = rows.length > LIBRARY_PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, LIBRARY_PAGE_SIZE) : rows;

  const items: LibraryGeneration[] = pageRows.map((g) => {
    const params = (g.params ?? {}) as { aspect_ratio?: string };
    return {
      id: g.id as string,
      type: g.type as string,
      provider: g.provider as string,
      model: g.model_id as string,
      prompt: (g.prompt as string | null) ?? '',
      status: g.status as string,
      thumbnailUrl: g.thumbnail_url ? publicThumbnailUrl(g.thumbnail_url as string) : null,
      hasOutput: Boolean(g.output_url),
      credits: (g.credits_charged as number | null) ?? 0,
      createdAt: g.created_at as string,
      parentGenerationId: (g.parent_generation_id as string | null) ?? null,
      batchId: (g.batch_id as string | null) ?? null,
      batchKind: (g.batch_kind as string | null) ?? null,
      campaignId: (g.campaign_id as string | null) ?? null,
      aspectRatio: params.aspect_ratio ?? null,
      qualityScore: (g.quality_score as number | null) ?? null,
      qualityFlags: (g.quality_flags as string[] | null) ?? [],
      qualitySummary: (g.quality_summary as string | null) ?? null,
    };
  });

  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
    total: cursor ? null : (count ?? items.length),
  };
}
