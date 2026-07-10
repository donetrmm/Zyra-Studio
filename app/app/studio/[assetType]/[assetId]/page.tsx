import { notFound, redirect } from 'next/navigation';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { loadPricing } from '@/lib/credits/pricing';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import {
  listStudioSessionsAction,
  listStudioSessionGenerationsAction,
} from '@/server-actions/studio';
import { loadStudioAsset, imageIdsFromAssetImages } from '@/lib/studio/asset-images';
import { parseUserPreset, type StudioPreset } from '@/lib/studio/presets';
import { StudioClient } from '@/components/studio/StudioClient';
import type {
  StudioTurn,
  StudioRefOption,
  StudioSessionOption,
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
  // Mismo loader que usa attachStudioImageAction (server-actions/studio.ts) al
  // re-leer fresco antes de fusionar — un solo select por tipo, sin drift.
  const loaded = await loadStudioAsset(supabase, workspace.id, type, assetId);
  if (!loaded) notFound();
  const assetName = loaded.name;
  const assetImages = loaded.assetImages;
  const imageIds = imageIdsFromAssetImages(assetImages);
  // Outfit/Estado son variaciones sobre la identidad canónica del personaje: sin
  // maestra no hay ancla, así que el estudio los habilita sólo cuando ya existe.
  const characterHasMaster =
    assetImages.assetType === 'character' ? assetImages.masterImageId !== null : false;

  const sessionsRes = await listStudioSessionsAction(type, assetId);
  const sessions: StudioSessionOption[] = sessionsRes.ok
    ? sessionsRes.data.map((s) => ({ id: s.id, title: s.title, createdAt: s.created_at }))
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
        aspectRatio: (g.params?.aspectRatio as string | undefined) ?? null,
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

  // Presets de imagen del usuario (se ofrecen en el compositor). RLS por user_id;
  // se filtran los que no traen un prompt usable.
  const { data: presetRows } = await supabase
    .from('presets')
    .select('id, name, params')
    .eq('user_id', user.id)
    .eq('type', 'image')
    .order('created_at', { ascending: false });
  const userPresets = (presetRows ?? [])
    .map((r) => parseUserPreset({ id: r.id as string, name: r.name as string, params: r.params }))
    .filter((p): p is StudioPreset => p !== null);

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
      userPresets={userPresets}
      characterHasMaster={characterHasMaster}
    />
  );
}
