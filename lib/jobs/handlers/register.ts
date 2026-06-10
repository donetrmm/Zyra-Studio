import 'server-only';
import { registerHandler } from '@/lib/jobs/dispatch';
import { elevenLabsHandler } from './elevenlabs';
import { klingHandler } from './kling';
import { seedanceHandler } from './seedance';
import { veoHandler } from './veo';

// Side-effect: registra todos los handlers en el dispatcher. Importar este
// archivo (desde el worker route) garantiza que los handlers estén disponibles
// antes de la primera llamada a dispatchJob.
registerHandler('elevenlabs', elevenLabsHandler);
registerHandler('kling', klingHandler);
registerHandler('seedance', seedanceHandler);
registerHandler('veo', veoHandler);
