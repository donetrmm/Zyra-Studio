import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { CharactersPage } from '@/components/characters/CharactersPage';

export const dynamic = 'force-dynamic';

export default async function CharactersRoute() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data: characters } = await supabase
    .from('characters')
    .select('id, name, description, reference_image_ids, created_at')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false });

  return <CharactersPage characters={characters ?? []} />;
}
