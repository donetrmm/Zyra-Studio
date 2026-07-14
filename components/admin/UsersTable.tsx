'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, ShieldOff, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CreditAdjustDialog } from "@/components/admin/CreditAdjustDialog";
import { setUserStatusAction, toggleAdminAction } from "@/server-actions/admin";
import { useConfirm } from "@/components/ui/confirm-dialog";

export type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: "user" | "admin";
  status: "active" | "suspended" | "deleted";
  balance: number;
  created_at: string;
};

export function UsersTable({ rows }: { rows: UserRow[] }) {
  return (
    <div className="scroll-thin overflow-x-auto rounded-md border border-border">
      <Table className="min-w-[700px]">
        <TableHeader>
          <TableRow>
            <TableHead>Usuario</TableHead>
            <TableHead>Rol</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead>Registro</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                Sin usuarios aún.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {u.full_name ?? u.email.split("@")[0]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {u.email}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                    {u.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={u.status === "active" ? "outline" : "destructive"}
                  >
                    {u.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {new Intl.NumberFormat("es-MX").format(u.balance)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(u.created_at).toLocaleDateString("es-MX")}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <ToggleAdminButton userId={u.id} email={u.email} currentRole={u.role} />
                    <SuspendButton
                      userId={u.id}
                      email={u.email}
                      currentStatus={u.status}
                      isAdmin={u.role === 'admin'}
                    />
                    <CreditAdjustDialog
                      userId={u.id}
                      email={u.email}
                      currentBalance={u.balance}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function ToggleAdminButton({ userId, email, currentRole }: { userId: string; email: string; currentRole: 'user' | 'admin' }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const isAdmin = currentRole === 'admin';

  async function handleToggle() {
    const newRole = isAdmin ? 'user' : 'admin';
    const ok = await confirm({
      title: isAdmin ? `Quitar admin a ${email}?` : `Hacer admin a ${email}?`,
      description: isAdmin
        ? 'Perdera acceso al panel de administracion.'
        : 'Tendra acceso completo al panel de administracion.',
      confirmLabel: isAdmin ? 'Quitar admin' : 'Hacer admin',
      destructive: isAdmin,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await toggleAdminAction(userId, newRole);
      if (res.ok) {
        toast.success(isAdmin ? 'Admin removido' : 'Admin asignado');
        router.refresh();
      } else {
        toast.error(res.error || 'Error');
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending}
      title={isAdmin ? 'Quitar admin' : 'Hacer admin'}
      className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isAdmin ? <ShieldOff className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
    </button>
  );
}

function SuspendButton({
  userId,
  email,
  currentStatus,
  isAdmin,
}: {
  userId: string;
  email: string;
  currentStatus: 'active' | 'suspended' | 'deleted';
  isAdmin: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const suspended = currentStatus === 'suspended';
  // 'deleted' es terminal (soft delete): sin acción de status.
  if (currentStatus === 'deleted') return null;

  async function handleToggle() {
    const ok = await confirm({
      title: suspended ? `Reactivar a ${email}?` : `Suspender a ${email}?`,
      description: suspended
        ? 'Recuperara el acceso a su cuenta y sus creditos.'
        : 'Perdera el acceso en su proximo request. Sus datos y creditos se conservan.',
      confirmLabel: suspended ? 'Reactivar' : 'Suspender',
      destructive: !suspended,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await setUserStatusAction(userId, suspended ? 'active' : 'suspended');
      if (res.ok) {
        toast.success(suspended ? 'Cuenta reactivada' : 'Cuenta suspendida');
        router.refresh();
      } else {
        toast.error(res.error || 'Error');
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending || (isAdmin && !suspended)}
      title={
        isAdmin && !suspended
          ? 'Quita el rol admin antes de suspender'
          : suspended
            ? 'Reactivar cuenta'
            : 'Suspender cuenta'
      }
      className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
    >
      {suspended ? <UserCheck className="size-3.5" /> : <UserX className="size-3.5" />}
    </button>
  );
}
