import 'server-only';
import { generate as generateGptImage, type GptImageModel, type GptImageQuality } from '@/lib/providers/gpt-image';
import { generate as generateFluxGateway, type FluxGatewayModel } from '@/lib/providers/flux-gateway';
import { generate as generateNano, nanoVariantToResolution } from '@/lib/providers/nano-banana';
import { ProviderError, type ImageReference, type NanoBananaParams } from '@/lib/providers/types';
import { resolveReferenceBuffers } from '@/lib/jobs/handlers/reference-buffers';
import { resolveBaseImage } from '@/lib/jobs/handlers/base-image';
import { mapProviderCode } from '@/lib/jobs/handlers/fail';
import { assembleStudioPrompt } from '@/lib/studio/prompt-assembly';
import type { GenerationRow, JobResult } from '@/lib/jobs/handlers/types';

// gpt-image no acepta un aspectRatio libre como Nano; mapea el ratio elegido al
// size soportado más cercano (comunes a gpt-image-1/mini/2). Sin esto, el submit
// escribe `aspectRatio` pero el turno gpt-image saldría siempre en el size
// default del gateway, ignorando el aspecto.
export function gptImageSize(aspectRatio: unknown): '1024x1024' | '1536x1024' | '1024x1536' {
  if (typeof aspectRatio !== 'string') return '1024x1024';
  const m = aspectRatio.match(/^(\d+):(\d+)$/);
  if (!m) return '1024x1024';
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w > h) return '1536x1024';
  if (h > w) return '1024x1536';
  return '1024x1024';
}

// Handler one-shot de imagen para el estudio creativo (Fase 1): nano-banana y
// gpt-image comparten este camino (a diferencia del storyboard, que sigue en
// nano-banana.ts con su propio flujo strict/conversational). Espeja el
// handler de ElevenLabs (también one-shot, sin polling).
export async function runImageTurn(gen: GenerationRow): Promise<JobResult> {
  // El claim atómico queued->processing anti-duplicados de QStash vive ahora
  // en el worker (route.ts paso 5.5) para TODOS los submits — este handler ya
  // llega con el claim ganado. No re-verificar aquí: un segundo claim sobre
  // 'queued' encontraría 0 filas y saltaría el turno legítimo.
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

    // Edición en contexto: si el turno tiene parent, su output es la imagen base.
    // Va como PRIMERA imagen (nano la toma como content-part; gpt-image como
    // prompt.images[0]). Si el padre no resuelve, degrada a texto-a-imagen.
    if (gen.parent_generation_id) {
      const base = await resolveBaseImage(gen.workspace_id, gen.parent_generation_id);
      if (base) references.unshift(base);
    }

    // El gateway acepta hasta 4 imágenes de entrada para gpt-image. Con base +
    // refs se puede pasar de 4 → se recorta (el schema ya limita referenceIds a 4,
    // pero la base es adicional). FLUX.2 admite hasta 10, pero el estudio lo acota
    // a 6 en v1 (base incluida) mientras la edición por gateway no está smoke-eada.
    // Nano tolera más, no se recorta.
    const providerReferences =
      gen.provider === 'gpt-image'
        ? references.slice(0, 4)
        : gen.provider === 'flux'
          ? references.slice(0, 6)
          : references;

    // Guard "mantener idéntico" (opt-in): anexa la cláusula de identidad del
    // activo al prompt que ve el proveedor. El prompt CRUDO queda en la fila.
    const finalPrompt = assembleStudioPrompt(gen.prompt ?? '', {
      keepIdentical: params.keepIdentical === true,
      assetType: typeof params.assetType === 'string' ? params.assetType : null,
    });

    if (gen.provider === 'flux') {
      // FLUX.2 [pro]/[max] por el gateway (bfl/…): image-only, aspecto directo por
      // aspectRatio (sin mapeo a size como gpt-image). La variant es 'default'
      // (no hay sub-calidad); el pricing es plano por imagen.
      const result = await generateFluxGateway({
        model: gen.model_id as FluxGatewayModel,
        prompt: finalPrompt,
        aspectRatio: typeof params.aspectRatio === 'string' ? params.aspectRatio : '1:1',
        references: providerReferences,
      });
      return {
        kind: 'finalize',
        outputBuffer: result.buffer,
        mimeType: result.mimeType,
        metadata: result.meta,
      };
    }

    if (gen.provider === 'gpt-image') {
      // gpt-image-2 usa la variant como quality (low/medium/high); gpt-image-1
      // y gpt-image-1-mini no aceptan quality (el adapter lo ignora si no es
      // gpt-image-2, pero no se lo mandamos igual para no fingir soporte).
      const quality = gen.model_id === 'gpt-image-2' ? (variant as GptImageQuality) : undefined;
      const result = await generateGptImage({
        model: gen.model_id as GptImageModel,
        prompt: finalPrompt,
        quality,
        size: gptImageSize(params.aspectRatio),
        references: providerReferences,
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
      prompt: finalPrompt,
      aspectRatio: typeof params.aspectRatio === 'string' ? params.aspectRatio : '1:1',
      resolution: nanoVariantToResolution(variant),
      references: providerReferences,
    });
    return {
      kind: 'finalize',
      outputBuffer: result.buffer,
      mimeType: result.mimeType,
      metadata: result.meta,
    };
  } catch (err) {
    if (err instanceof ProviderError) return { kind: 'fail', message: err.message, code: mapProviderCode(err) };
    return {
      kind: 'fail',
      message: err instanceof Error ? err.message : 'error de generación',
      code: 'unknown',
    };
  }
}
