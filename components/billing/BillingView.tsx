'use client';

import { useState, useTransition } from 'react';
import { Check, Coins, History, ShoppingBag, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLiveBalance } from '@/components/layout/use-live-balance';
import { createPurchaseAction } from '@/server-actions/billing';
import { PACKS, type PackId } from '@/lib/billing/packs';
import { cn } from '@/lib/utils';

export type PurchaseRow = {
  id: string;
  packId: string;
  credits: number;
  priceMxn: number;
  status: 'pending' | 'approved' | 'rejected';
  notes: string | null;
  createdAt: string;
  approvedAt: string | null;
};

export type TransactionRow = {
  id: string;
  delta: number;
  reason: string;
  createdAt: string;
};

const PACK_META: Record<PackId, { label: string; subtitle: string; highlight?: boolean }> = {
  starter: { label: 'Starter', subtitle: 'Para probar' },
  creator: { label: 'Creator', subtitle: 'Recomendado', highlight: true },
  pro: { label: 'Pro', subtitle: 'Producción' },
  studio: { label: 'Studio', subtitle: 'Equipo / agencia' },
};

const PACK_ORDER: PackId[] = ['starter', 'creator', 'pro', 'studio'];

export function BillingView({
  userId,
  initialBalance,
  pending,
  purchases,
  transactions,
}: {
  userId: string;
  initialBalance: number;
  pending: number;
  purchases: PurchaseRow[];
  transactions: TransactionRow[];
}) {
  const balance = useLiveBalance(userId, initialBalance);
  const [busyPack, setBusyPack] = useState<PackId | null>(null);
  const [, startTransition] = useTransition();

  function handleBuy(pack: PackId) {
    setBusyPack(pack);
    startTransition(async () => {
      const res = await createPurchaseAction({ packId: pack });
      setBusyPack(null);
      if (!res.ok) {
        const msg =
          res.error === 'already_pending'
            ? 'Ya tienes una compra pendiente de este pack.'
            : res.message ?? 'No se pudo crear la compra.';
        toast.error(msg);
        return;
      }
      toast.success('Compra creada. Espera la aprobación del admin.');
    });
  }

  const pendingPurchases = purchases.filter((p) => p.status === 'pending');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground">
            Compra créditos para generar imagen, video y voz.
          </p>
        </div>
        <Card className="px-5 py-3">
          <div className="flex items-center gap-3">
            <Coins className="size-5 text-primary" aria-hidden />
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Balance
              </p>
              <p className="font-heading text-2xl font-semibold tabular-nums">
                {fmt(balance)}
              </p>
              {pending > 0 && (
                <p className="text-xs text-muted-foreground">{fmt(pending)} reservados</p>
              )}
            </div>
          </div>
        </Card>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PACK_ORDER.map((pack) => {
          const meta = PACK_META[pack];
          const cfg = PACKS[pack];
          return (
            <Card
              key={pack}
              className={cn(
                'flex flex-col gap-4 p-5',
                meta.highlight && 'border-primary/40',
              )}
            >
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {meta.subtitle}
                </p>
                <h3 className="font-heading text-xl font-semibold">{meta.label}</h3>
              </div>
              <div>
                <p className="font-heading text-3xl font-semibold tabular-nums">
                  {fmt(cfg.credits)}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    créditos
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">${cfg.priceMxn} MXN</p>
              </div>
              <Button
                className="mt-auto"
                disabled={busyPack !== null}
                onClick={() => handleBuy(pack)}
                variant={meta.highlight ? 'default' : 'outline'}
              >
                <ShoppingBag className="size-4" aria-hidden />
                {busyPack === pack ? 'Procesando…' : 'Comprar'}
              </Button>
            </Card>
          );
        })}
      </section>

      <Tabs defaultValue="pending" className="space-y-3">
        <TabsList>
          <TabsTrigger value="pending">Pendientes ({pendingPurchases.length})</TabsTrigger>
          <TabsTrigger value="all">Historial</TabsTrigger>
          <TabsTrigger value="transactions">Movimientos</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <PurchaseList list={pendingPurchases} emptyLabel="Sin compras pendientes." />
        </TabsContent>

        <TabsContent value="all">
          <PurchaseList list={purchases} emptyLabel="Aún no hay compras." />
        </TabsContent>

        <TabsContent value="transactions">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading text-lg">
                <History className="mr-2 inline size-4" aria-hidden /> Movimientos
              </CardTitle>
              <CardDescription>
                Cargos y devoluciones de créditos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {transactions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin movimientos.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {transactions.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="capitalize text-muted-foreground">
                        {t.reason.replace(/_/g, ' ')}
                      </span>
                      <span
                        className={cn(
                          'tabular-nums',
                          t.delta > 0 ? 'text-emerald-400' : 'text-rose-400',
                        )}
                      >
                        {t.delta > 0 ? '+' : ''}
                        {fmt(t.delta)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PurchaseList({
  list,
  emptyLabel,
}: {
  list: PurchaseRow[];
  emptyLabel: string;
}) {
  if (list.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">{emptyLabel}</Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {list.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-4 px-5 py-3"
            >
              <div>
                <p className="font-medium capitalize">{p.packId}</p>
                <p className="text-xs text-muted-foreground">
                  {fmt(p.credits)} créditos · ${p.priceMxn} MXN
                </p>
              </div>
              <StatusBadge status={p.status} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  if (status === 'approved') {
    return (
      <Badge variant="outline" className="gap-1 text-emerald-400">
        <Check className="size-3" aria-hidden /> Aprobada
      </Badge>
    );
  }
  if (status === 'rejected') {
    return (
      <Badge variant="outline" className="gap-1 text-rose-400">
        <X className="size-3" aria-hidden /> Rechazada
      </Badge>
    );
  }
  return <Badge variant="secondary">Pendiente</Badge>;
}

function fmt(n: number): string {
  return new Intl.NumberFormat('es-MX').format(n);
}
