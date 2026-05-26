import { requireWorkspace } from '@/lib/auth/dal';
import { loadPricing } from '@/lib/credits/pricing';
import { createClient } from '@/lib/supabase/server';
import { StoryboardEditor } from '@/components/storyboard/StoryboardEditor';

export const dynamic = 'force-dynamic';

export default async function StoryboardRoute() {
  const { user } = await requireWorkspace();
  const supabase = await createClient();
  const { data: balance } = await supabase
    .from('credit_balances')
    .select('balance')
    .eq('user_id', user.id)
    .single();
  const pricing = await loadPricing();
  return (
    <StoryboardEditor
      userId={user.id}
      initialBalance={(balance?.balance as number | undefined) ?? 0}
      pricing={pricing}
    />
  );
}
