'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

type PanelUpdate = { campaignItemId: string; status: string; errorMessage: string | null };

// Suscribe a postgres_changes en generations (RLS filtra ownership) y notifica cambios
// de estado de paneles de storyboard. NO se filtra por campaign_id en el servidor: la
// tabla tiene REPLICA IDENTITY default (solo PK), asi que un filtro sobre columna no-PK
// no entrega eventos de forma fiable. Se filtra en el cliente por row.campaign_id (el
// payload new de un UPDATE trae la fila completa). El campaignItemId sale de
// params.storyboard.campaignItemId (== beat.id). setAuth explicito antes de subscribe.
export function useStoryboardPanelRealtime(
  campaignId: string,
  onUpdate: (u: PanelUpdate) => void,
): void {
  useEffect(() => {
    const supabase = createClient();
    let active = true;

    const emit = (row: Record<string, unknown>) => {
      if (!active) return;
      if (row.campaign_id !== campaignId) return;
      const params = (row.params ?? {}) as { storyboard?: { campaignItemId?: unknown } };
      const itemId = params.storyboard?.campaignItemId;
      if (typeof itemId !== 'string') return;
      onUpdate({
        campaignItemId: itemId,
        status: String(row.status ?? ''),
        errorMessage: (row.error_message as string | null) ?? null,
      });
    };

    const channel = supabase
      .channel(`storyboard:${campaignId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'generations' },
        (payload) => emit(payload.new as Record<string, unknown>),
      );

    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe();
    });

    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }
    });

    return () => {
      active = false;
      authSub.subscription.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [campaignId, onUpdate]);
}
