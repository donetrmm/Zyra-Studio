'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

export type PanelUpdate = { campaignItemId: string; status: string; errorMessage: string | null };

// Mapea una fila de generations a un PanelUpdate, o null si no aplica (otra campana o
// no es una generacion de storyboard). Pura: sirve tanto para el evento Realtime como
// para la reconciliacion al montar. Se filtra campaign_id aqui (no en el servidor)
// porque generations tiene REPLICA IDENTITY default (solo PK) y un filtro Realtime sobre
// columna no-PK no entrega eventos fiablemente; el payload new de un UPDATE trae la fila
// completa. El campaignItemId sale de params.storyboard.campaignItemId (== beat.id).
export function panelUpdateFromRow(row: Record<string, unknown>, campaignId: string): PanelUpdate | null {
  if (row.campaign_id !== campaignId) return null;
  const params = (row.params ?? {}) as { storyboard?: { campaignItemId?: unknown } };
  const itemId = params.storyboard?.campaignItemId;
  if (typeof itemId !== 'string') return null;
  return {
    campaignItemId: itemId,
    status: String(row.status ?? ''),
    errorMessage: (row.error_message as string | null) ?? null,
  };
}

// Suscribe a postgres_changes en generations (RLS filtra ownership) y notifica cambios
// de estado de paneles de storyboard. Al montar, ademas reconcilia: consulta las
// generaciones en vuelo (queued/processing) de la campana y las emite, para que un
// panel que quedo generando sobreviva a una recarga (el subscribe cierra su estado
// terminal). setAuth explicito antes de subscribe (RLS).
export function useStoryboardPanelRealtime(
  campaignId: string,
  onUpdate: (u: PanelUpdate) => void,
): void {
  useEffect(() => {
    const supabase = createClient();
    let active = true;

    const emit = (row: Record<string, unknown>) => {
      if (!active) return;
      const u = panelUpdateFromRow(row, campaignId);
      if (u) onUpdate(u);
    };

    const channel = supabase
      .channel(`storyboard:${campaignId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'generations' },
        (payload) => emit(payload.new as Record<string, unknown>),
      );

    // Reconciliacion al montar: emite las generaciones en vuelo tras suscribir (asi un
    // evento entre la query y el subscribe no se pierde). Query PostgREST normal: el
    // filtro campaign_id aqui si es fiable (no depende de REPLICA IDENTITY).
    const reconcile = () => {
      void supabase
        .from('generations')
        .select('status, error_message, params, campaign_id')
        .eq('campaign_id', campaignId)
        .in('status', ['queued', 'processing'])
        .then(({ data }) => {
          if (!active || !data) return;
          for (const row of data) emit(row as Record<string, unknown>);
        });
    };

    supabase.auth.getSession().then(({ data }) => {
      // El componente pudo desmontarse mientras getSession resolvia; si el cleanup
      // ya removio el canal, no lo suscribas (evita un canal colgado / leak de socket).
      if (!active) return;
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe();
      reconcile();
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
