import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { publicThumbnailUrl } from '@/lib/supabase/storage';
import { LibraryView, type LibraryGeneration } from '@/components/library/LibraryView';

export const metadata: Metadata = {
  title: 'Biblioteca',
};

export default async function LibraryPage() {
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const [generationsRes, favRes] = await Promise.all([
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

  return (
    <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-8">
      <LibraryView
        generations={generations}
        workspaceName={workspace.name}
        initialFavoriteIds={favoriteIds}
      />
    </div>
  );
}
