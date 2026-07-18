import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fetchLibraryPage } from '@/lib/library/list';
import { LibraryView } from '@/components/library/LibraryView';
import type { Collection } from '@/components/library/CollectionsTab';

export const metadata: Metadata = {
  title: 'Biblioteca',
};

export default async function LibraryPage() {
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const [page, favRes, collectionsRes, countsRes] = await Promise.all([
    // Primera página (60). Filtrado, búsqueda y "cargar más" siguen por
    // listLibraryAction con la misma query compartida (lib/library/list).
    fetchLibraryPage(supabase, workspace.id, user.id, {}, null),
    supabase
      .from('favorites')
      .select('generation_id')
      .eq('user_id', user.id),
    // Colecciones de la Biblioteca: las carpetas V1 (sin brief, editables) +
    // las campañas studio (con brief), que aparecen como colección automática
    // de solo-lectura con todo lo que generan (ligado por campaign_id). Se
    // excluyen las archivadas.
    supabase
      .from('campaigns')
      .select('id, name, description, color, created_at, product_brief, status')
      .eq('workspace_id', workspace.id)
      .neq('status', 'archived')
      .order('created_at', { ascending: false }),
    // Conteo agregado en SQL (066): antes se traían TODAS las filas con
    // campaign_id solo para contarlas en memoria.
    supabase.rpc('library_campaign_counts', { p_workspace_id: workspace.id }),
  ]);

  const favoriteIds = (favRes.data ?? []).map((r) => r.generation_id as string);

  const countByCampaign = new Map<string, number>();
  for (const r of countsRes.data ?? []) {
    countByCampaign.set(r.campaign_id as string, Number(r.total));
  }
  const collections: Collection[] = (collectionsRes.data ?? []).map((c) => {
    const brief = (c.product_brief ?? null) as { productName?: string } | null;
    const isStudio = Boolean(brief?.productName);
    return {
      id: c.id as string,
      name: c.name as string,
      // Para la campaña studio, el subtítulo es el producto detectado; para una
      // colección-carpeta, su descripción libre.
      description: isStudio ? (brief?.productName ?? null) : ((c.description as string | null) ?? null),
      color: (c.color as string) ?? '#009fff',
      created_at: c.created_at as string,
      generationCount: countByCampaign.get(c.id as string) ?? 0,
      readOnly: isStudio,
    };
  });

  return (
    <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-8">
      <LibraryView
        generations={page.items}
        initialHasMore={page.hasMore}
        initialTotal={page.total}
        workspaceName={workspace.name}
        initialFavoriteIds={favoriteIds}
        collections={collections}
      />
    </div>
  );
}
