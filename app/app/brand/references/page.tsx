import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import { ReferencesPage } from '@/components/references/ReferencesPage';

export const dynamic = 'force-dynamic';

export default async function ReferencesRoute() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data: refs } = await supabase
    .from('media_references')
    .select('id, type, storage_url, name, source, created_at')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false })
    .limit(60);

  const references = await Promise.all(
    (refs ?? []).map(async (r) => {
      let previewUrl: string | null = null;
      try {
        previewUrl = await signedReferenceUrl(r.storage_url);
      } catch {}
      return {
        id: r.id as string,
        type: r.type as string,
        name: (r.name as string) ?? 'Sin nombre',
        source: r.source as string,
        previewUrl,
        createdAt: r.created_at as string,
      };
    }),
  );

  return <ReferencesPage references={references} />;
}
