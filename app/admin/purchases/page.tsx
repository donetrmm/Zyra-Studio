import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { PurchasesView, type AdminPurchaseRow } from '@/components/admin/PurchasesView';

export const metadata: Metadata = {
  title: 'Compras',
};

export default async function AdminPurchasesPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data } = await supabase
    .from('credit_purchases')
    .select(
      'id, user_id, pack_id, credits, price_mxn, status, notes, created_at, approved_at, profiles!credit_purchases_user_id_fkey(email, full_name)',
    )
    .order('created_at', { ascending: false })
    .limit(200);

  type Row = {
    id: string;
    user_id: string;
    pack_id: string;
    credits: number;
    price_mxn: string | number;
    status: 'pending' | 'approved' | 'rejected';
    notes: string | null;
    created_at: string;
    approved_at: string | null;
    profiles: { email: string; full_name: string | null } | null;
  };
  const rows: AdminPurchaseRow[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    userEmail: r.profiles?.email ?? '—',
    userName: r.profiles?.full_name ?? null,
    packId: r.pack_id,
    credits: r.credits,
    priceMxn: Number(r.price_mxn),
    status: r.status,
    notes: r.notes,
    createdAt: r.created_at,
    approvedAt: r.approved_at,
  }));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Compras</h1>
        <p className="text-sm text-muted-foreground">
          Aprueba o rechaza compras pendientes.
        </p>
      </header>
      <PurchasesView purchases={rows} />
    </div>
  );
}
