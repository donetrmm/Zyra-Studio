import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { publicThumbnailUrl } from '@/lib/supabase/storage';
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
        'id, type, provider, model_id, prompt, status, thumbnail_url, output_url, credits_charged, created_at, params',
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

  const generations: LibraryGeneration[] = (generationsRes.data ?? []).map((g) => ({
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
  }));

  const references: LibraryReference[] = (referencesRes.data ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    storagePath: r.storage_url,
    name: r.name,
    source: r.source,
    createdAt: r.created_at,
  }));

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Biblioteca</h1>
        <p className="text-sm text-muted-foreground">
          Generaciones y referencias de {workspace.name}.
        </p>
      </header>
      <LibraryView generations={generations} references={references} />
    </div>
  );
}
