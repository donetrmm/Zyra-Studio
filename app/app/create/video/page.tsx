import { requireWorkspace } from '@/lib/auth/dal';
import { loadPricing } from '@/lib/credits/pricing';
import { createClient } from '@/lib/supabase/server';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import { VideoGenerator } from '@/components/generation/VideoGenerator';
import type {
  BrandKitAsset,
  BrandKitOption,
  CastOption,
} from '@/components/generation/SeedanceBrandCastPanel';

export const dynamic = 'force-dynamic';

export default async function CreateVideoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const [{ data: balance }, pricing, { data: kits }, { data: chars }] = await Promise.all([
    supabase.from('credit_balances').select('balance').eq('user_id', user.id).single(),
    loadPricing(),
    supabase
      .from('brand_kits')
      .select('id, name, product_image_ids, packaging_image_ids, reference_image_ids')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('characters')
      .select('id, name, master_image_id, reference_image_ids')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false }),
  ]);

  // Compat V1: kits sin product_image_ids usan reference_image_ids como producto.
  const productIdsOf = (k: { product_image_ids: unknown; reference_image_ids: unknown }) =>
    ((k.product_image_ids as string[]) ?? []).length
      ? ((k.product_image_ids as string[]) ?? [])
      : ((k.reference_image_ids as string[]) ?? []);
  const masterIdOf = (c: { master_image_id: unknown; reference_image_ids: unknown }) =>
    (c.master_image_id as string | null) ?? ((c.reference_image_ids as string[]) ?? [])[0] ?? null;

  const kitRows = kits ?? [];
  const charRows = chars ?? [];
  const imageIds = new Set<string>();
  for (const k of kitRows) {
    productIdsOf(k).forEach((id) => imageIds.add(id));
    ((k.packaging_image_ids as string[]) ?? []).forEach((id) => imageIds.add(id));
  }
  for (const c of charRows) {
    const masterId = masterIdOf(c);
    if (masterId) imageIds.add(masterId);
  }

  // id de media_reference → ruta de storage + preview firmada para el panel.
  const assets = new Map<string, { storagePath: string; previewUrl: string }>();
  if (imageIds.size) {
    const { data: mediaRefs } = await supabase
      .from('media_references')
      .select('id, storage_url')
      .in('id', [...imageIds]);
    await Promise.all(
      (mediaRefs ?? []).map(async (r) => {
        if (!r.storage_url) return;
        try {
          assets.set(r.id as string, {
            storagePath: r.storage_url as string,
            previewUrl: await signedReferenceUrl(r.storage_url as string),
          });
        } catch {
          // sin preview firmable: se omite del panel
        }
      }),
    );
  }

  const brandKits: BrandKitOption[] = kitRows.map((k) => {
    const seen = new Set<string>();
    const images: BrandKitAsset[] = [];
    const push = (id: string, role: BrandKitAsset['role']) => {
      const a = assets.get(id);
      if (a && !seen.has(a.storagePath)) {
        seen.add(a.storagePath);
        images.push({ ...a, role });
      }
    };
    productIdsOf(k).forEach((id) => push(id, 'producto'));
    ((k.packaging_image_ids as string[]) ?? []).forEach((id) => push(id, 'empaque'));
    return { id: k.id as string, name: k.name as string, images };
  });

  const cast: CastOption[] = charRows.flatMap((c) => {
    const masterId = masterIdOf(c);
    const a = masterId ? assets.get(masterId) : undefined;
    return a ? [{ id: c.id as string, name: c.name as string, ...a }] : [];
  });

  return (
    <VideoGenerator
      userId={user.id}
      initialBalance={(balance?.balance as number | undefined) ?? 0}
      pricing={pricing}
      initialPrompt={params.prompt}
      brandKits={brandKits}
      cast={cast}
    />
  );
}
