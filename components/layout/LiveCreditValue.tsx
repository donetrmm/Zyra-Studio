"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  useAnimatedNumber,
  useFlashOnChange,
} from "@/hooks/useAnimatedNumber";

type Props = {
  userId: string;
  initialBalance: number;
  className?: string;
};

// Subscripción + número animado. Misma data que CreditPill (los dos
// observadores reciben el mismo evento por separado).
// Patrón setAuth obligatorio (ver feedback en memory / CreditPill.tsx).
export function LiveCreditValue({ userId, initialBalance, className }: Props) {
  const [balance, setBalance] = useState(initialBalance);
  const animated = useAnimatedNumber(balance);
  const flash = useFlashOnChange(balance);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      if (cancelled) return;

      channel = supabase
        .channel(`credit_balances_live:${userId}`)
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

  return (
    <span
      className={cn(
        "tabular-nums transition-colors duration-300",
        flash === "up" && "text-emerald-400",
        flash === "down" && "text-rose-400",
        className,
      )}
    >
      {new Intl.NumberFormat("es-MX").format(animated)}
    </span>
  );
}
