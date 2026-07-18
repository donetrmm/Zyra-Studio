'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, Users } from 'lucide-react';
import { redeemInviteAction } from '@/server-actions/team';

type Peek =
  | { status: 'valid'; workspaceName: string; role: string }
  | { status: 'not_found' | 'used' | 'expired' };

const INVALID_COPY: Record<'not_found' | 'used' | 'expired', string> = {
  not_found: 'Este link de invitación no existe o fue revocado.',
  used: 'Este link ya fue usado — pide uno nuevo a quien te invitó.',
  expired: 'Este link expiró — pide uno nuevo a quien te invitó.',
};

export function JoinCard({ token, peek }: { token: string; peek: Peek }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleJoin() {
    startTransition(async () => {
      const res = await redeemInviteAction({ token });
      if (!res.ok) {
        toast.error(res.message ?? 'No se pudo unir al workspace');
        return;
      }
      const r = res.data;
      if (r.status === 'joined' || r.status === 'already_member') {
        toast.success(
          r.status === 'joined'
            ? `Bienvenido a ${r.workspaceName ?? 'tu nuevo workspace'}`
            : 'Ya eras miembro — workspace activado',
        );
        router.push('/app');
        router.refresh();
        return;
      }
      toast.error(INVALID_COPY[r.status] ?? 'Invitación inválida');
      router.refresh();
    });
  }

  return (
    <div className="w-full rounded-xl border border-border bg-muted/20 p-6 text-center">
      <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full border border-primary/30 bg-primary/10">
        <Users className="size-5 text-primary" aria-hidden />
      </div>

      {peek.status === 'valid' ? (
        <>
          <h1 className="font-heading text-[18px] font-semibold text-foreground">
            Te invitaron a {peek.workspaceName}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Entrarás como {peek.role === 'editor' ? 'editor' : peek.role}: puedes crear y
            editar usando tus propios créditos.
          </p>
          <button
            type="button"
            onClick={handleJoin}
            disabled={pending}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2.5 text-[13.5px] font-medium text-foreground transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Unirme al workspace
          </button>
        </>
      ) : (
        <>
          <h1 className="font-heading text-[18px] font-semibold text-foreground">
            Invitación no disponible
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{INVALID_COPY[peek.status]}</p>
          <Link
            href="/app"
            className="mt-5 inline-flex w-full items-center justify-center rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-[13.5px] font-medium text-foreground transition-colors hover:border-muted-foreground/30"
          >
            Volver a mi workspace
          </Link>
        </>
      )}
    </div>
  );
}
