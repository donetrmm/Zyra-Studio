import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { BillingView, type PurchaseRow, type TransactionRow } from '@/components/billing/BillingView';

export const metadata: Metadata = {
  title: 'Billing',
};

export default async function BillingPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [balanceRes, purchasesRes, txRes] = await Promise.all([
    supabase
      .from('credit_balances')
      .select('balance, pending')
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('credit_purchases')
      .select('id, pack_id, credits, price_mxn, status, notes, created_at, approved_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('credit_transactions')
      .select('id, delta, reason, generation_id, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(60),
  ]);

  // Desglose por generación: qué modelo y qué prompt hay detrás de cada cargo.
  // Batch único; una generación borrada de la biblioteca deja el movimiento sin
  // detalle (solo reason), que es el comportamiento esperado.
  const genIds = Array.from(
    new Set((txRes.data ?? []).map((t) => t.generation_id).filter(Boolean)),
  ) as string[];
  const genById = new Map<
    string,
    { modelId: string; type: string; prompt: string | null }
  >();
  if (genIds.length > 0) {
    const { data: gens } = await supabase
      .from('generations')
      .select('id, model_id, type, prompt')
      .in('id', genIds);
    for (const g of gens ?? []) {
      genById.set(g.id as string, {
        modelId: g.model_id as string,
        type: g.type as string,
        prompt: (g.prompt as string | null) ?? null,
      });
    }
  }

  const purchases: PurchaseRow[] = (purchasesRes.data ?? []).map((p) => ({
    id: p.id,
    packId: p.pack_id,
    credits: p.credits,
    priceMxn: Number(p.price_mxn),
    status: p.status as 'pending' | 'approved' | 'rejected',
    notes: p.notes,
    createdAt: p.created_at,
    approvedAt: p.approved_at,
  }));

  const transactions: TransactionRow[] = (txRes.data ?? []).map((t) => {
    const gen = t.generation_id ? genById.get(t.generation_id as string) : undefined;
    return {
      id: t.id,
      delta: Number(t.delta),
      reason: t.reason,
      createdAt: t.created_at,
      generation: gen
        ? {
            modelId: gen.modelId,
            type: gen.type,
            promptSnippet: gen.prompt ? gen.prompt.slice(0, 90) : null,
          }
        : null,
    };
  });

  return (
    <div className="mx-auto w-full max-w-5xl">
      <BillingView
        userId={user.id}
        initialBalance={balanceRes.data?.balance ?? 0}
        pending={balanceRes.data?.pending ?? 0}
        purchases={purchases}
        transactions={transactions}
      />
    </div>
  );
}
