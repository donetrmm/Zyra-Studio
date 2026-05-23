"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  useAnimatedNumber,
  useFlashOnChange,
} from "@/hooks/useAnimatedNumber";

type Props = {
  userId: string;
  initialBalance: number;
};

export function CreditPill({ userId, initialBalance }: Props) {
  const [balance, setBalance] = useState(initialBalance);
  const animated = useAnimatedNumber(balance);
  const flash = useFlashOnChange(balance);

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

  const formatted = new Intl.NumberFormat("es-MX").format(animated);

  return (
    <Link
      href="/app/billing"
      className={cn(
        "group inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium transition-all duration-300 hover:border-primary/60 hover:text-primary",
        flash === "up" && "border-emerald-400/60 ring-1 ring-emerald-400/30",
        flash === "down" && "border-rose-400/60 ring-1 ring-rose-400/30",
      )}
      aria-label={`${formatted} créditos disponibles`}
      aria-live="polite"
    >
      <Coins
        className={cn(
          "size-4 text-primary transition-all duration-300",
          flash === "up" && "scale-110 text-emerald-400",
          flash === "down" && "scale-110 text-rose-400",
        )}
        aria-hidden
      />
      <span
        className={cn(
          "tabular-nums transition-colors duration-300",
          flash === "up" && "text-emerald-400",
          flash === "down" && "text-rose-400",
        )}
      >
        {formatted}
      </span>
      <span className="hidden text-muted-foreground sm:inline">créditos</span>
    </Link>
  );
}
