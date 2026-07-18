import 'server-only';
import { registerHandler } from '@/lib/jobs/dispatch';
import { elevenLabsHandler } from './elevenlabs';
import { fluxHandler } from './flux';
import { gptImageHandler } from './gpt-image';
import { klingHandler } from './kling';
import { nanoBananaHandler } from './nano-banana';
import { seedanceHandler } from './seedance';
import { veoHandler } from './veo';

// Side-effect: registra todos los handlers en el dispatcher. Importar este
// archivo (desde el worker route) garantiza que los handlers estén disponibles
// antes de la primera llamada a dispatchJob.
registerHandler('elevenlabs', elevenLabsHandler);
registerHandler('flux', fluxHandler);
registerHandler('gpt-image', gptImageHandler);
registerHandler('kling', klingHandler);
registerHandler('nano-banana', nanoBananaHandler);
registerHandler('seedance', seedanceHandler);
registerHandler('veo', veoHandler);
