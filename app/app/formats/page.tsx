import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { FormatsPage, type FormatRowUi } from '@/components/formats/FormatsPage';

export const dynamic = 'force-dynamic';

export default async function FormatsRoute() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from('formats')
    .select('id, slug, name, description, register, camera_style, pacing, required_refs, default_duration_s, default_audio, is_system')
    .or(`is_system.eq.true,workspace_id.eq.${workspace.id}`)
    .order('is_system', { ascending: false })
    .order('name');

  const formats: FormatRowUi[] = (rows ?? []).map((f) => ({
    id: f.id as string,
    slug: f.slug as string,
    name: f.name as string,
    description: (f.description as string | null) ?? null,
    register: (f.register as string | null) ?? null,
    cameraStyle: (f.camera_style as string | null) ?? null,
    pacing: (f.pacing as string | null) ?? null,
    requiredRefs: (f.required_refs as string[]) ?? [],
    defaultDurationS: (f.default_duration_s as number) ?? 8,
    defaultAudio: (f.default_audio as boolean) ?? true,
    isSystem: (f.is_system as boolean) ?? false,
  }));

  return <FormatsPage formats={formats} />;
}
