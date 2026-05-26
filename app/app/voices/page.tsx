import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { VoicesPage } from '@/components/voices/VoicesPage';

export const dynamic = 'force-dynamic';

export default async function VoicesRoute() {
  const { user } = await requireWorkspace();
  const supabase = await createClient();
  const { data: voices } = await supabase
    .from('voice_clones')
    .select('id, name, description, elevenlabs_voice_id, status, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return <VoicesPage voices={voices ?? []} />;
}
