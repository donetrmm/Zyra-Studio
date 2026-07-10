import { notFound, redirect } from 'next/navigation';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { loadPricing } from '@/lib/credits/pricing';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import {
  listStudioSessionsAction,
  listStudioSessionGenerationsAction,
} from '@/server-actions/studio';
import { StudioClient } from '@/components/studio/StudioClient';
import type { StudioTurn, StudioRefOption, StudioSessionOption } from '@/components/studio/types';

export const dynamic = 'force-dynamic';

export default async function StudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ assetType: string; assetId: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { assetType, assetId } = await params;
  const { session: sessionParam } = await searchParams;

  // Fase 2 solo cablea producto (locación/personaje = Fase 4).
  if (assetType !== 'product') notFound();

  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: product } = await supabase
    .from('products')
    .select('id, name, product_image_ids, packaging_image_ids')
    .eq('id', assetId)
    .eq('workspace_id', workspace.id)
    .maybeSingle();
  if (!product) notFound();

  const sessionsRes = await listStudioSessionsAction('product', assetId);
  const sessions: StudioSessionOption[] = sessionsRes.ok
    ? sessionsRes.data.map((s) => ({ id: s.id, createdAt: s.created_at }))
    : [];

  // Sesión activa: ?session válida y propia, si no la más reciente (redirige para
  // fijarla en la URL), si no hay ninguna → estado limpio (el primer turno crea).
  let activeSessionId: string | null = null;
  if (sessionParam && sessions.some((s) => s.id === sessionParam)) {
    activeSessionId = sessionParam;
  } else if (!sessionParam && sessions.length > 0) {
    redirect(`/app/studio/product/${assetId}?session=${sessions[0].id}`);
  }

  let initialItems: StudioTurn[] = [];
  if (activeSessionId) {
    const gensRes = await listStudioSessionGenerationsAction(activeSessionId);
    if (gensRes.ok) {
      initialItems = gensRes.data.map((g) => ({
        id: g.id,
        prompt: g.prompt,
        status: g.status,
        provider: g.provider,
        modelId: g.model_id,
        thumbPath: g.thumbnail_url,
        createdAt: g.created_at,
        errorMessage: null,
      }));
    }
  }

  // Referencias ofrecibles en el compositor = imágenes que el producto ya tiene.
  const imageIds = [
    ...((product.product_image_ids as string[] | null) ?? []),
    ...((product.packaging_image_ids as string[] | null) ?? []),
  ];
  let availableReferences: StudioRefOption[] = [];
  if (imageIds.length > 0) {
    const { data: refs } = await supabase
      .from('media_references')
      .select('id, storage_url, name')
      .in('id', imageIds)
      .eq('workspace_id', workspace.id)
      .eq('type', 'image');
    availableReferences = await Promise.all(
      (refs ?? []).map(async (r) => ({
        id: r.id as string,
        previewUrl: r.storage_url ? await signedReferenceUrl(r.storage_url as string) : null,
        filename: (r.name as string | null) ?? 'imagen',
      })),
    );
  }

  const balanceRow = await supabase
    .from('credit_balances')
    .select('balance')
    .eq('user_id', user.id)
    .maybeSingle();
  const initialBalance = (balanceRow.data?.balance as number | null) ?? 0;

  const pricing = await loadPricing();

  return (
    <StudioClient
      workspaceId={workspace.id}
      userId={user.id}
      assetType="product"
      assetId={assetId}
      assetName={(product.name as string | null) ?? 'Producto'}
      initialBalance={initialBalance}
      pricing={pricing}
      sessions={sessions}
      activeSessionId={activeSessionId}
      initialItems={initialItems}
      availableReferences={availableReferences}
      productImages={{
        productImageIds: (product.product_image_ids as string[] | null) ?? [],
        packagingImageIds: (product.packaging_image_ids as string[] | null) ?? [],
      }}
    />
  );
}
