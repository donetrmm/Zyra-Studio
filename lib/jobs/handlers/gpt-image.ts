import 'server-only';
import { runImageTurn } from '@/lib/jobs/handlers/image-turn';
import type { JobHandler } from '@/lib/jobs/handlers/types';

// gpt-image es one-shot (sin polling, sin acción de submit/poll distinta):
// se genera y finaliza en la misma invocación. Espeja elevenlabs.ts.
export const gptImageHandler: JobHandler = {
  handle: (gen) => runImageTurn(gen),
};
