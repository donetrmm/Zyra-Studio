import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { generate as generateGptImage, type GptImageModel, type GptImageQuality } from '@/lib/providers/gpt-image';
import { generate as generateNano, nanoVariantToResolution } from '@/lib/providers/nano-banana';
import { ProviderError, type ImageReference, type NanoBananaParams } from '@/lib/providers/types';
import { resolveReferenceBuffers } from '@/lib/jobs/handlers/reference-buffers';
import type { GenerationRow, JobResult } from '@/lib/jobs/handlers/types';

export function mapCode(err: ProviderError): 'safety' | 'rate_limit' | 'timeout' | 'unknown' {
  if (err.code === 'safety') return 'safety';
  if (err.code === 'rate_limit') return 'rate_limit';
  if (err.code === 'timeout') return 'timeout';
  return 'unknown';
}

// Handler one-shot de imagen para el estudio creativo (Fase 1): nano-banana y
// gpt-image comparten este camino (a diferencia del storyboard, que sigue en
// nano-banana.ts con su propio flujo strict/conversational). Espeja el
// handler de ElevenLabs (también one-shot, sin polling).
export async function runImageTurn(gen: GenerationRow): Promise<JobResult> {
  // Claim atómico queued->processing: QStash puede reentregar el mismo mensaje
  // (retries) y este handler no tiene un 'continue' que lo re-encole con un
  // nuevo estado — sin este guard, dos invocaciones concurrentes generarían y
  // cobrarían/reembolsarían dos veces la misma fila.
  const admin = createAdminClient();
  const { count, error: claimError } = await admin
    .from('generations')
    .update({ status: 'processing' }, { count: 'exact' })
    .eq('id', gen.id)
    .eq('status', 'queued');
  if (claimError) {
    return { kind: 'fail', message: `claim falló: ${claimError.message}`, code: 'unknown' };
  }
  if (!count) return { kind: 'skip' };

  const params = (gen.params ?? {}) as Record<string, unknown>;
  const variant = typeof params.variant === 'string' ? params.variant : '';

  try {
    // Dentro del try: si una referencia falla (objeto de Storage borrado, blip
    // de DB) el throw se convierte en 'fail' -> refund + mensaje, en vez de
    // dejar la fila colgada en 'processing' (ya reclamada arriba) sin refund.
    const references: ImageReference[] = await resolveReferenceBuffers(
      gen.workspace_id,
      gen.reference_ids ?? [],
    );

    if (gen.provider === 'gpt-image') {
      // gpt-image-2 usa la variant como quality (low/medium/high); gpt-image-1
      // y gpt-image-1-mini no aceptan quality (el adapter lo ignora si no es
      // gpt-image-2, pero no se lo mandamos igual para no fingir soporte).
      const quality = gen.model_id === 'gpt-image-2' ? (variant as GptImageQuality) : undefined;
      const result = await generateGptImage({
        model: gen.model_id as GptImageModel,
        prompt: gen.prompt ?? '',
        quality,
        size: typeof params.size === 'string' ? params.size : undefined,
        references,
      });
      return {
        kind: 'finalize',
        outputBuffer: result.buffer,
        mimeType: result.mimeType,
        metadata: result.meta,
      };
    }
    // nano-banana: la variant ('1k'/'2k'/'4k') se mapea a la resolución que
    // espera el provider con el MISMO helper que usa submitGenerationAction
    // (lib/providers/nano-banana.ts) — sin duplicar el mapeo.
    const result = await generateNano({
      model: gen.model_id as NanoBananaParams['model'],
      prompt: gen.prompt ?? '',
      aspectRatio: typeof params.aspectRatio === 'string' ? params.aspectRatio : '1:1',
      resolution: nanoVariantToResolution(variant),
      references,
    });
    return {
      kind: 'finalize',
      outputBuffer: result.buffer,
      mimeType: result.mimeType,
      metadata: result.meta,
    };
  } catch (err) {
    if (err instanceof ProviderError) return { kind: 'fail', message: err.message, code: mapCode(err) };
    return {
      kind: 'fail',
      message: err instanceof Error ? err.message : 'error de generación',
      code: 'unknown',
    };
  }
}
