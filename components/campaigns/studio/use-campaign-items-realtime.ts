'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

export type CampaignItemRealtimeRow = {
  id: string;
  status: string;
  warnings?: string[];
  generation_id?: string | null;
};

// Suscribe a postgres_changes (UPDATE) de campaign_items de una campaña con el
// patron setAuth del repo (token fresco antes de subscribe y al rotar). Entrega
// la fila nueva por onUpdate; el merge en el estado lo hace el caller (identico
// al inline previo). Deps [campaignId]: una suscripcion por campaña.
export function useCampaignItemsRealtime(
  campaignId: string,
  onUpdate: (row: CampaignItemRealtimeRow) => void,
): void {
  const onUpdateRef = useRef(onUpdate);
  // Mantener la ref sincronizada fuera del render (useLayoutEffect = sincrono
  // post-DOM, antes del paint; evita la lectura de ref obsoleta en eventos RT).
  useLayoutEffect(() => {
    onUpdateRef.current = onUpdate;
  });
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`campaign-items:${campaignId}`).on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'campaign_items', filter: `campaign_id=eq.${campaignId}` },
      (payload) => onUpdateRef.current(payload.new as CampaignItemRealtimeRow),
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
      authSub.subscription.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [campaignId]);
}
