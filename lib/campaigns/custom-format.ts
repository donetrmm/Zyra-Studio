import 'server-only';
import type { createClient } from '@/lib/supabase/server';

// Inserción de un formato custom con recuperación ante colisión del UNIQUE
// global de formats.slug. Antes vivía duplicado en generatePlanAction y
// acceptRefinedItemAction con políticas divergentes; aquí se unifica y cada
// caller elige si auto-resuelve el conflicto (uniquifyOnConflict).

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

export type CustomFormatInput = {
  slug: string;
  name: string;
  description: string;
  register: string | null;
  cameraStyle: string | null;
  pacing: string | null;
  requiredRefs: string[];
  defaultDurationS: number;
  defaultAudio: boolean;
};

export type CustomFormatOutcome =
  // Insertado nuevo (el caller debe revalidar /app/formats).
  | { status: 'created'; id: string; slug: string }
  // Reusado uno ya existente del workspace (no se creó nada).
  | { status: 'recovered'; id: string; slug: string }
  // Slug ocupado por otro workspace y no se auto-resolvió (uniquify=false).
  | { status: 'conflict' }
  // Error de DB distinto a la colisión de slug.
  | { status: 'error'; message: string };

function insertRow(supabase: SupabaseServer, workspaceId: string, slug: string, cf: CustomFormatInput) {
  return supabase
    .from('formats')
    .insert({
      slug,
      name: cf.name,
      description: cf.description,
      register: cf.register,
      camera_style: cf.cameraStyle,
      pacing: cf.pacing,
      required_refs: cf.requiredRefs,
      default_duration_s: cf.defaultDurationS,
      default_audio: cf.defaultAudio,
      is_system: false,
      workspace_id: workspaceId,
    })
    .select('id, slug')
    .single();
}

export async function insertOrRecoverCustomFormat(
  supabase: SupabaseServer,
  workspaceId: string,
  cf: CustomFormatInput,
  opts: { uniquifyOnConflict: boolean },
): Promise<CustomFormatOutcome> {
  const { data: created, error } = await insertRow(supabase, workspaceId, cf.slug, cf);
  if (created) return { status: 'created', id: created.id as string, slug: created.slug as string };
  if (error?.code !== '23505') return { status: 'error', message: error?.message ?? 'insert falló' };

  // Slug ocupado globalmente. ¿Ya lo tiene este workspace (plan/refine previo),
  // bajo el slug base o el uniquificado? Reusar sin crear.
  const retrySlug = `${cf.slug}-${workspaceId.slice(0, 8)}`;
  const { data: owned } = await supabase
    .from('formats')
    .select('id, slug')
    .eq('workspace_id', workspaceId)
    .in('slug', [cf.slug, retrySlug])
    .limit(1)
    .maybeSingle();
  if (owned) return { status: 'recovered', id: owned.id as string, slug: owned.slug as string };

  if (!opts.uniquifyOnConflict) return { status: 'conflict' };

  // Pertenece a otro workspace: uniquificar y reintentar para no perder la idea.
  const { data: retried, error: retryErr } = await insertRow(supabase, workspaceId, retrySlug, cf);
  if (retried) return { status: 'created', id: retried.id as string, slug: retried.slug as string };
  return { status: 'error', message: retryErr?.message ?? 'retry de slug falló' };
}
