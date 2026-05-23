"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

type Props = {
  userId: string;
  initialBalance: number;
};

export function CreditPill({ userId, initialBalance }: Props) {
  const [balance, setBalance] = useState(initialBalance);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    // Patrón obligatorio para subscripciones Realtime con RLS en @supabase/ssr:
    // setAuth explícito ANTES de subscribir. Sin esto, el JWT no se propaga al
    // canal, auth.uid() evalúa null y la RLS bloquea los eventos en silencio
    // (la subscripción se acepta pero nunca llegan UPDATEs).
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      if (cancelled) return;

      channel = supabase
        .channel(`credit_balances:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "credit_balances",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const next = (payload.new as { balance?: number } | null)?.balance;
            if (typeof next === "number") setBalance(next);
          },
        )
        .subscribe();
    })();

    // Re-propaga el token cuando Supabase lo refresca, para que la subscripción
    // siga válida sin caerse.
    const { data: authSub } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "TOKEN_REFRESHED" && session?.access_token) {
          supabase.realtime.setAuth(session.access_token);
        }
      },
    );

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId]);

  const formatted = new Intl.NumberFormat("es-MX").format(balance);

  return (
    <Link
      href="/app/billing"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:border-primary/60 hover:text-primary",
      )}
      aria-label={`${formatted} créditos disponibles`}
    >
      <Coins className="size-4 text-primary" aria-hidden />
      <span className="tabular-nums">{formatted}</span>
      <span className="hidden text-muted-foreground sm:inline">créditos</span>
    </Link>
  );
}
