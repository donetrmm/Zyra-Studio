'use client';

import { useEffect } from 'react';
import { useGenerationStatus } from '@/components/generation/use-generation-status';

export function GenerationStatusWatcher(props: {
  generationId: string;
  onResolved: (
    id: string,
    patch: { status: 'done' | 'failed' | 'canceled'; thumbPath: string | null; errorMessage: string | null },
  ) => void;
}) {
  const live = useGenerationStatus(props.generationId);
  const status = live?.status ?? null;

  useEffect(() => {
    if (status === 'done' || status === 'failed' || status === 'canceled') {
      props.onResolved(props.generationId, {
        status,
        thumbPath: live?.thumbnailUrl ?? null,
        errorMessage: live?.errorMessage ?? null,
      });
    }
    // Solo re-dispara al cambiar el estado terminal o el id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, props.generationId]);

  return null;
}
