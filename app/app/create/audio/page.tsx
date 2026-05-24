import { requireWorkspace } from '@/lib/auth/dal';
import { loadPricing } from '@/lib/credits/pricing';
import { createClient } from '@/lib/supabase/server';
import { AudioGenerator } from '@/components/generation/AudioGenerator';

export const dynamic = 'force-dynamic';

export default async function CreateAudioPage() {
  const { user } = await requireWorkspace();
  const supabase = await createClient();
  const { data: balance } = await supabase
    .from('credit_balances')
    .select('balance')
    .eq('user_id', user.id)
    .single();
  const pricing = await loadPricing();
  return (
    <AudioGenerator
      userId={user.id}
      initialBalance={(balance?.balance as number | undefined) ?? 0}
      pricing={pricing}
    />
  );
}
