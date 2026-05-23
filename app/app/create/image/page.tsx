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

type SearchParams = Promise<{
  prompt?: string;
  aspect?: string;
  model?: string;
}>;

const VALID_ASPECTS = new Set([
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
]);
const VALID_MODELS = new Set(['auto', 'nano-pro', 'nano-flash', 'flux']);

export default async function CreateImagePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();
  const sp = await searchParams;
  const initialPrompt = typeof sp.prompt === 'string' ? sp.prompt.slice(0, 8000) : '';
  const initialAspect =
    typeof sp.aspect === 'string' && VALID_ASPECTS.has(sp.aspect)
      ? sp.aspect
      : undefined;
  const initialModelKey =
    typeof sp.model === 'string' && VALID_MODELS.has(sp.model)
      ? (sp.model as 'auto' | 'nano-pro' | 'nano-flash' | 'flux')
      : undefined;

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

  // key fuerza remount cuando cambian los query params (ej. el usuario hace
  // "Reusar prompt" en library dos veces seguidas con prompts distintos).
  // Trade-off: pierde session/refs en curso, pero es el comportamiento que
  // espera el usuario al "empezar de nuevo con este prompt".
  const remountKey = `${initialPrompt}|${initialAspect ?? ''}|${initialModelKey ?? ''}`;

  return (
    <ImageGenerator
      key={remountKey}
      userId={user.id}
      workspaceId={workspace.id}
      initialBalance={balance}
      pricing={pricing}
      availableReferences={availableReferences}
      initialPrompt={initialPrompt}
      initialAspect={initialAspect}
      initialModelKey={initialModelKey}
    />
  );
}
