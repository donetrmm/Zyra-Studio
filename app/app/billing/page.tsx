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
      .select('id, delta, reason, created_at, metadata')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(60),
  ]);

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

  const transactions: TransactionRow[] = (txRes.data ?? []).map((t) => ({
    id: t.id,
    delta: Number(t.delta),
    reason: t.reason,
    createdAt: t.created_at,
  }));

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
