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
import type {
  StudioTurn,
  StudioRefOption,
  StudioSessionOption,
  StudioAssetImages,
  StudioAssetType,
} from '@/components/studio/types';

export const dynamic = 'force-dynamic';

const ASSET_TYPES: StudioAssetType[] = ['product', 'location', 'character'];

export default async function StudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ assetType: string; assetId: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { assetType, assetId } = await params;
  const { session: sessionParam } = await searchParams;

  if (!ASSET_TYPES.includes(assetType as StudioAssetType)) notFound();
  const type = assetType as StudioAssetType;

  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  // Resuelve el activo + arma assetImages (entidad completa para loc/char) +
  // la lista de ids de imágenes que ya tiene (para ofrecerlas como referencia).
  let assetName = '';
  let assetImages: StudioAssetImages;
  let imageIds: string[] = [];

  if (type === 'product') {
    const { data: product } = await supabase
      .from('products')
      .select('id, name, product_image_ids, packaging_image_ids')
      .eq('id', assetId)
      .eq('workspace_id', workspace.id)
      .maybeSingle();
    if (!product) notFound();
    assetName = (product.name as string | null) ?? 'Producto';
    const productImageIds = (product.product_image_ids as string[] | null) ?? [];
    const packagingImageIds = (product.packaging_image_ids as string[] | null) ?? [];
    assetImages = { assetType: 'product', productImageIds, packagingImageIds };
    imageIds = [...productImageIds, ...packagingImageIds];
  } else if (type === 'location') {
    const { data: loc } = await supabase
      .from('locations')
      .select('id, name, description, master_image_id, reference_image_ids, scale_map_image_id, scale_map_notes')
      .eq('id', assetId)
      .eq('workspace_id', workspace.id)
      .maybeSingle();
    if (!loc) notFound();
    assetName = (loc.name as string | null) ?? 'Locación';
    const masterImageId = (loc.master_image_id as string | null) ?? null;
    const referenceImageIds = (loc.reference_image_ids as string[] | null) ?? [];
    const scaleMapImageId = (loc.scale_map_image_id as string | null) ?? null;
    assetImages = {
      assetType: 'location',
      name: assetName,
      description: (loc.description as string | null) ?? null,
      masterImageId,
      referenceImageIds,
      scaleMapImageId,
      scaleMapNotes: (loc.scale_map_notes as string | null) ?? null,
    };
    imageIds = [masterImageId, ...referenceImageIds, scaleMapImageId].filter((x): x is string => !!x);
  } else {
    const { data: ch } = await supabase
      .from('characters')
      .select('id, name, description, master_image_id, angle_image_ids, full_body_image_id, voice_clone_id')
      .eq('id', assetId)
      .eq('workspace_id', workspace.id)
      .maybeSingle();
    if (!ch) notFound();
    assetName = (ch.name as string | null) ?? 'Personaje';
    const masterImageId = (ch.master_image_id as string | null) ?? null;
    const angleImageIds = (ch.angle_image_ids as string[] | null) ?? [];
    const fullBodyImageId = (ch.full_body_image_id as string | null) ?? null;
    assetImages = {
      assetType: 'character',
      name: assetName,
      description: (ch.description as string | null) ?? null,
      masterImageId,
      angleImageIds,
      fullBodyImageId,
      voiceCloneId: (ch.voice_clone_id as string | null) ?? null,
    };
    imageIds = [masterImageId, ...angleImageIds, fullBodyImageId].filter((x): x is string => !!x);
  }

  const sessionsRes = await listStudioSessionsAction(type, assetId);
  const sessions: StudioSessionOption[] = sessionsRes.ok
    ? sessionsRes.data.map((s) => ({ id: s.id, createdAt: s.created_at }))
    : [];

  // Sesión activa: ?session válida y propia, si no la más reciente (redirige para
  // fijarla en la URL), si no hay ninguna → estado limpio (el primer turno crea).
  let activeSessionId: string | null = null;
  if (sessionParam && sessions.some((s) => s.id === sessionParam)) {
    activeSessionId = sessionParam;
  } else if (sessions.length > 0) {
    // ?session ausente o inválido (ajeno/archivado) pero hay sesiones: fija la
    // más reciente en la URL en vez de caer a estado vacío.
    redirect(`/app/studio/${type}/${assetId}?session=${sessions[0].id}`);
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
      key={activeSessionId ?? 'new'}
      workspaceId={workspace.id}
      userId={user.id}
      assetType={type}
      assetId={assetId}
      assetName={assetName}
      initialBalance={initialBalance}
      pricing={pricing}
      sessions={sessions}
      activeSessionId={activeSessionId}
      initialItems={initialItems}
      availableReferences={availableReferences}
      assetImages={assetImages}
    />
  );
}
