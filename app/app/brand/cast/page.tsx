import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import { loadPricing } from '@/lib/credits/pricing';
import { estimateCredits } from '@/lib/credits/estimator';
import { CastPage, type CastCharacter, type CastVoice } from '@/components/cast/CastPage';

export const dynamic = 'force-dynamic';

export default async function CastRoute() {
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from('characters')
    .select('id, name, description, master_image_id, angle_image_ids, reference_image_ids, voice_clone_id, full_body_image_id')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false });

  // Voces disponibles para asignar (clonadas o cargadas). Solo listas: el picker
  // muestra nombre; el enlace guarda el id.
  const { data: voiceRows } = await supabase
    .from('voice_clones')
    .select('id, name, elevenlabs_voice_id, sample_storage_url')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const voices: CastVoice[] = (voiceRows ?? []).map((v) => ({
    id: v.id as string,
    name: v.name as string,
    // Clonada (ElevenLabs) vs cargada (audio subido) se distingue por
    // elevenlabs_voice_id — las clonadas también guardan sample ahora.
    kind: v.elevenlabs_voice_id ? 'cloned' : 'uploaded',
    // Solo las voces con audio de muestra sirven como referencia de timbre en video.
    hasSample: !!v.sample_storage_url,
  }));

  const characters: CastCharacter[] = (rows ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    description: (c.description as string | null) ?? null,
    // Compat V1: si no hay hoja maestra designada, la primera referencia.
    master_image_id:
      (c.master_image_id as string | null) ?? ((c.reference_image_ids as string[]) ?? [])[0] ?? null,
    angle_image_ids: (c.angle_image_ids as string[]) ?? [],
    voice_clone_id: (c.voice_clone_id as string | null) ?? null,
    full_body_image_id: (c.full_body_image_id as string | null) ?? null,
  }));

  const allImageIds = [
    ...new Set(
      characters
        .flatMap((c) => [c.master_image_id, c.full_body_image_id, ...c.angle_image_ids])
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

  // Costo del generador de hoja maestra (FLUX 2MP) para mostrarlo en el botón.
  let fluxCost = 0;
  try {
    const pricing = await loadPricing();
    fluxCost = estimateCredits(pricing, {
      provider: 'flux',
      model: 'flux-2-pro-preview',
      variant: 'default',
      params: { megapixels: 2, references: 0 },
    }).total;
  } catch {
    // sin fila de pricing: el botón se muestra sin costo
  }

  return <CastPage characters={characters} previews={previews} voices={voices} fluxCost={fluxCost} />;
}
