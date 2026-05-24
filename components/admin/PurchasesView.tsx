'use client';

import { useMemo, useState, useTransition } from 'react';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { approvePurchaseAction, rejectPurchaseAction } from '@/server-actions/billing';

export type AdminPurchaseRow = {
  id: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  packId: string;
  credits: number;
  priceMxn: number;
  status: 'pending' | 'approved' | 'rejected';
  notes: string | null;
  createdAt: string;
  approvedAt: string | null;
};

export function PurchasesView({ purchases }: { purchases: AdminPurchaseRow[] }) {
  const [rejecting, setRejecting] = useState<AdminPurchaseRow | null>(null);
  const [reason, setReason] = useState('');
  const [busy, startTransition] = useTransition();

  const groups = useMemo(() => {
    return {
      pending: purchases.filter((p) => p.status === 'pending'),
      approved: purchases.filter((p) => p.status === 'approved'),
      rejected: purchases.filter((p) => p.status === 'rejected'),
    };
  }, [purchases]);

  function handleApprove(id: string) {
    startTransition(async () => {
      const res = await approvePurchaseAction({ id });
      if (!res.ok) {
        toast.error(res.message ?? 'No se pudo aprobar.');
        return;
      }
      toast.success('Compra aprobada.');
    });
  }

  function handleRejectSubmit() {
    if (!rejecting) return;
    startTransition(async () => {
      const res = await rejectPurchaseAction({ id: rejecting.id, reason });
      if (!res.ok) {
        toast.error(res.message ?? 'No se pudo rechazar.');
        return;
      }
      toast.success('Compra rechazada.');
      setRejecting(null);
      setReason('');
    });
  }

  return (
    <Tabs defaultValue="pending" className="space-y-4">
      <TabsList>
        <TabsTrigger value="pending">
          Pendientes ({groups.pending.length})
        </TabsTrigger>
        <TabsTrigger value="approved">Aprobadas ({groups.approved.length})</TabsTrigger>
        <TabsTrigger value="rejected">Rechazadas ({groups.rejected.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="pending">
        <PurchaseTable
          rows={groups.pending}
          renderActions={(row) => (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleApprove(row.id)}
                disabled={busy}
              >
                <Check className="size-4" aria-hidden /> Aprobar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRejecting(row)}
                disabled={busy}
              >
                <X className="size-4" aria-hidden /> Rechazar
              </Button>
            </div>
          )}
        />
      </TabsContent>

      <TabsContent value="approved">
        <PurchaseTable rows={groups.approved} />
      </TabsContent>

      <TabsContent value="rejected">
        <PurchaseTable rows={groups.rejected} />
      </TabsContent>

      <Dialog open={!!rejecting} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar compra</DialogTitle>
            <DialogDescription>
              {rejecting?.userEmail} · {rejecting?.packId}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Motivo del rechazo (visible para el usuario)…"
            maxLength={500}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              onClick={handleRejectSubmit}
              disabled={busy || reason.trim().length < 3}
            >
              Rechazar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}

function PurchaseTable({
  rows,
  renderActions,
}: {
  rows: AdminPurchaseRow[];
  renderActions?: (row: AdminPurchaseRow) => React.ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">Nada por aquí.</Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate font-medium">{row.userName ?? row.userEmail}</p>
                <p className="text-xs text-muted-foreground">{row.userEmail}</p>
                <p className="text-xs text-muted-foreground">
                  <Badge variant="outline" className="mr-1 capitalize">
                    {row.packId}
                  </Badge>
                  {fmt(row.credits)} créditos · ${row.priceMxn} MXN
                </p>
                {row.notes && (
                  <p className="mt-1 text-xs italic text-muted-foreground">
                    “{row.notes}”
                  </p>
                )}
              </div>
              {renderActions && renderActions(row)}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat('es-MX').format(n);
}
