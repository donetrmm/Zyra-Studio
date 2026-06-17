import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { publicThumbnailUrl } from '@/lib/supabase/storage';
import { LibraryView, type LibraryGeneration } from '@/components/library/LibraryView';
import type { Collection } from '@/components/library/CollectionsTab';

export const metadata: Metadata = {
  title: 'Biblioteca',
};

export default async function LibraryPage() {
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const [generationsRes, favRes, collectionsRes, countsRes] = await Promise.all([
    supabase
      .from('generations')
      .select(
        'id, type, provider, model_id, prompt, status, thumbnail_url, output_url, credits_charged, created_at, params, parent_generation_id, batch_id, batch_kind, campaign_id',
      )
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(120),
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
    supabase
      .from('generations')
      .select('campaign_id')
      .eq('workspace_id', workspace.id)
      .not('campaign_id', 'is', null),
  ]);

  const favoriteIds = (favRes.data ?? []).map((r) => r.generation_id as string);

  const generations: LibraryGeneration[] = (generationsRes.data ?? []).map((g) => {
    const params = (g.params ?? {}) as { aspect_ratio?: string };
    return {
      id: g.id,
      type: g.type,
      provider: g.provider,
      model: g.model_id,
      prompt: g.prompt ?? '',
      status: g.status,
      thumbnailUrl: g.thumbnail_url ? publicThumbnailUrl(g.thumbnail_url) : null,
      hasOutput: Boolean(g.output_url),
      credits: g.credits_charged ?? 0,
      createdAt: g.created_at,
      parentGenerationId: g.parent_generation_id as string | null,
      batchId: (g.batch_id as string | null) ?? null,
      batchKind: (g.batch_kind as string | null) ?? null,
      campaignId: (g.campaign_id as string | null) ?? null,
      aspectRatio: params.aspect_ratio ?? null,
    };
  });

  const countByCampaign = new Map<string, number>();
  for (const r of countsRes.data ?? []) {
    const cid = r.campaign_id as string;
    countByCampaign.set(cid, (countByCampaign.get(cid) ?? 0) + 1);
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
        generations={generations}
        workspaceName={workspace.name}
        initialFavoriteIds={favoriteIds}
        collections={collections}
      />
    </div>
  );
}
