import 'server-only';
import { runImageTurn } from '@/lib/jobs/handlers/image-turn';
import type { JobHandler } from '@/lib/jobs/handlers/types';

// FLUX.2 [pro] y [max] del estudio por el gateway: one-shot como gpt-image (sin
// polling, sin submit/poll distinta) -> runImageTurn. Los únicos jobs 'flux' que
// llegan al dispatcher son turnos del estudio; el FLUX del storyboard/expand
// (model_id 'flux-2-pro-preview', BFL directo) corre inline y NUNCA pasa por
// dispatchJob, así que registrar este handler no lo afecta.
export const fluxHandler: JobHandler = {
  handle: (gen) => runImageTurn(gen),
};
