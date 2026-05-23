import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { loadPricing } from '@/lib/credits/pricing';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import {
  ImageGenerator,
  type AvailableReference,
} from '@/components/generation/ImageGenerator';

export const metadata: Metadata = {
  title: 'Generar imagen',
};

export default async function CreateImagePage() {
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const [balanceRes, pricing, referencesRes] = await Promise.all([
    supabase
      .from('credit_balances')
      .select('balance')
      .eq('user_id', user.id)
      .single(),
    loadPricing(),
    supabase
      .from('media_references')
      .select('id, storage_url, name, source, created_at')
      .eq('workspace_id', workspace.id)
      .eq('type', 'image')
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  const balance = balanceRes.data?.balance ?? 0;

  // Firmamos las URLs de preview en paralelo. Si alguna falla (archivo borrado,
  // path inválido), la dejamos null y la card se muestra como placeholder.
  const availableReferences: AvailableReference[] = await Promise.all(
    (referencesRes.data ?? []).map(async (r) => {
      let previewUrl: string | null = null;
      try {
        previewUrl = await signedReferenceUrl(r.storage_url);
      } catch {
        previewUrl = null;
      }
      return {
        id: r.id,
        storagePath: r.storage_url,
        previewUrl,
        filename: r.name ?? 'referencia',
        source: r.source,
      };
    }),
  );

  return (
    <ImageGenerator
      userId={user.id}
      workspaceId={workspace.id}
      initialBalance={balance}
      pricing={pricing}
      availableReferences={availableReferences}
    />
  );
}
