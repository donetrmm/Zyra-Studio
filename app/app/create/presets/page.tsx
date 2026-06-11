import { requireUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { PresetsPage } from '@/components/presets/PresetsPage';

export const dynamic = 'force-dynamic';

export default async function PresetsRoute() {
  const user = await requireUser();
  const supabase = await createClient();

  const [myRes, publicRes] = await Promise.all([
    supabase
      .from('presets')
      .select('id, type, name, description, params, is_public, uses_count, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('presets')
      .select('id, type, name, description, params, is_public, uses_count, created_at, user_id')
      .eq('is_public', true)
      .order('uses_count', { ascending: false })
      .limit(30),
  ]);

  return (
    <PresetsPage
      userId={user.id}
      myPresets={myRes.data ?? []}
      publicPresets={publicRes.data ?? []}
    />
  );
}
