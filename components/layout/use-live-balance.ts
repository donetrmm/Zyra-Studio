'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Hook compartido: devuelve el balance live del user, ya escuchando Realtime.
// La animación visual vive en LiveCreditValue; este hook solo expone el número.
export function useLiveBalance(userId: string, initial: number): number {
  const [balance, setBalance] = useState(initial);

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
        .channel(`credit_balance_hook:${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'credit_balances',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const next = (payload.new as { balance?: number } | null)?.balance;
            if (typeof next === 'number') setBalance(next);
          },
        )
        .subscribe();
    })();

    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }
    });

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId]);

  return balance;
}
