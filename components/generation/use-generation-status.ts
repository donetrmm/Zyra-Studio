'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export type GenerationStatus = 'queued' | 'processing' | 'done' | 'failed' | 'canceled';

export type LiveGeneration = {
  status: GenerationStatus;
  errorMessage: string | null;
  outputUrl: string | null;
  thumbnailUrl: string | null;
  creditsCharged: number | null;
};

// Suscribe a postgres_changes en la row específica de generations.
// La policy RLS de SELECT ya garantiza ownership.
//
// El state se guarda junto al id que lo produjo. Si el caller cambia el
// generationId, descartamos cualquier state que vino del id anterior
// (evita parpadear con datos viejos antes de que llegue el SELECT inicial).
export function useGenerationStatus(generationId: string | null): LiveGeneration | null {
  const [entry, setEntry] = useState<{ id: string; data: LiveGeneration } | null>(null);

  useEffect(() => {
    if (!generationId) return;
    const supabase = createClient();
    let active = true;
    const myId = generationId;
    const setState = (data: LiveGeneration) => {
      if (!active) return;
      setEntry({ id: myId, data });
    };

    // Carga inicial
    supabase
      .from('generations')
      .select('status, error_message, output_url, thumbnail_url, credits_charged')
      .eq('id', myId)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setState({
          status: data.status as GenerationStatus,
          errorMessage: data.error_message,
          outputUrl: data.output_url,
          thumbnailUrl: data.thumbnail_url,
          creditsCharged: data.credits_charged,
        });
      });

    // Realtime: setAuth explícito antes de subscribe (RLS lo necesita)
    const channel = supabase
      .channel(`generation:${myId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'generations',
          filter: `id=eq.${myId}`,
        },
        (payload) => {
          const r = payload.new as Record<string, unknown>;
          setState({
            status: r.status as GenerationStatus,
            errorMessage: (r.error_message as string | null) ?? null,
            outputUrl: (r.output_url as string | null) ?? null,
            thumbnailUrl: (r.thumbnail_url as string | null) ?? null,
            creditsCharged: (r.credits_charged as number | null) ?? null,
          });
        },
      );

    // Patrón del repo: token freshness antes de subscribe
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        supabase.realtime.setAuth(data.session.access_token);
      }
      channel.subscribe();
    });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [generationId]);

  // Si el id que generó el state ya no es el actual, devolvemos null hasta
  // que llegue data del nuevo id.
  if (!generationId) return null;
  if (entry && entry.id === generationId) return entry.data;
  return null;
}
