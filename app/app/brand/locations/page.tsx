import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import { loadPricing } from '@/lib/credits/pricing';
import { estimateCredits } from '@/lib/credits/estimator';
import { LocationsPage, type Location } from '@/components/locations/LocationsPage';

export const dynamic = 'force-dynamic';

export default async function LocationsRoute() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from('locations')
    .select('id, name, description, master_image_id, reference_image_ids, scale_map_image_id, scale_map_notes')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false });

  const locations: Location[] = (rows ?? []).map((l) => ({
    id: l.id as string,
    name: l.name as string,
    description: (l.description as string | null) ?? null,
    master_image_id: (l.master_image_id as string | null) ?? null,
    reference_image_ids: (l.reference_image_ids as string[]) ?? [],
    scale_map_image_id: (l.scale_map_image_id as string | null) ?? null,
    scale_map_notes: (l.scale_map_notes as string | null) ?? null,
  }));

  const allImageIds = [
    ...new Set(
      locations
        .flatMap((l) => [l.master_image_id, l.scale_map_image_id, ...l.reference_image_ids])
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

  // Costo de "Generar locacion con IA" para mostrarlo en el boton ANTES de actuar.
  // Input = mirror de components/locations/LocationsPage.tsx (FLUX 2 Pro, 2 megapixels,
  // sin referencias).
  let generateCost: number | null = null;
  try {
    const pricing = await loadPricing();
    generateCost = estimateCredits(pricing, {
      provider: 'flux',
      model: 'flux-2-pro-preview',
      variant: 'default',
      params: { megapixels: 2, references: 0 },
    }).total;
  } catch {
    // Sin pricing no mostramos costo (el boton sigue funcionando).
  }

  return <LocationsPage locations={locations} previews={previews} generateCost={generateCost} />;
}
