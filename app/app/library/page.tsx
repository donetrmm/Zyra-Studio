import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { publicThumbnailUrl, signedReferenceUrl } from '@/lib/supabase/storage';
import { LibraryView, type LibraryGeneration, type LibraryReference } from '@/components/library/LibraryView';

export const metadata: Metadata = {
  title: 'Biblioteca',
};

export default async function LibraryPage() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const [generationsRes, referencesRes] = await Promise.all([
    supabase
      .from('generations')
      .select(
        'id, type, provider, model_id, prompt, status, thumbnail_url, output_url, credits_charged, created_at, params, parent_generation_id',
      )
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(120),
    supabase
      .from('media_references')
      .select('id, type, storage_url, name, source, created_at')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(60),
  ]);

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
      aspectRatio: params.aspect_ratio ?? null,
    };
  });

  // Firmamos las URLs en paralelo. Si falla (e.g. archivo borrado), dejamos
  // previewUrl null y la card cae a placeholder.
  const references: LibraryReference[] = await Promise.all(
    (referencesRes.data ?? []).map(async (r) => {
      let previewUrl: string | null = null;
      if (r.type === 'image') {
        try {
          previewUrl = await signedReferenceUrl(r.storage_url);
        } catch {
          previewUrl = null;
        }
      }
      return {
        id: r.id,
        type: r.type,
        storagePath: r.storage_url,
        name: r.name,
        source: r.source,
        createdAt: r.created_at,
        previewUrl,
      };
    }),
  );

  return (
    <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-8">
      <LibraryView
        generations={generations}
        references={references}
        workspaceName={workspace.name}
      />
    </div>
  );
}
