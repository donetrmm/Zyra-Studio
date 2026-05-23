import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { loadPricing } from '@/lib/credits/pricing';
import { ImageGenerator } from '@/components/generation/ImageGenerator';

export const metadata: Metadata = {
  title: 'Generar imagen',
};

export default async function CreateImagePage() {
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const [balanceRes, pricing] = await Promise.all([
    supabase
      .from('credit_balances')
      .select('balance')
      .eq('user_id', user.id)
      .single(),
    loadPricing(),
  ]);

  const balance = balanceRes.data?.balance ?? 0;

  return (
    <ImageGenerator
      userId={user.id}
      workspaceId={workspace.id}
      initialBalance={balance}
      pricing={pricing}
    />
  );
}
