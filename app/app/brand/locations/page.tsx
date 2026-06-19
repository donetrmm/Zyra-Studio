import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import { LocationsPage, type Location } from '@/components/locations/LocationsPage';

export const dynamic = 'force-dynamic';

export default async function LocationsRoute() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from('locations')
    .select('id, name, description, master_image_id, reference_image_ids')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false });

  const locations: Location[] = (rows ?? []).map((l) => ({
    id: l.id as string,
    name: l.name as string,
    description: (l.description as string | null) ?? null,
    master_image_id: (l.master_image_id as string | null) ?? null,
    reference_image_ids: (l.reference_image_ids as string[]) ?? [],
  }));

  const allImageIds = [
    ...new Set(
      locations
        .flatMap((l) => [l.master_image_id, ...l.reference_image_ids])
        .filter((id): id is string => !!id),
    ),
  ];
  const previews: Record<string, string> = {};
  if (allImageIds.length) {
    const { data: refs } = await supabase
      .from('media_references')
      .select('id, storage_url')
      .in('id', allImageIds);
    await Promise.all(
      (refs ?? []).map(async (r) => {
        if (!r.storage_url) return;
        try {
          previews[r.id as string] = await signedReferenceUrl(r.storage_url as string);
        } catch {
          // sin preview
        }
      }),
    );
  }

  return <LocationsPage locations={locations} previews={previews} />;
}
