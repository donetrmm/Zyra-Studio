import 'server-only';
import { registerHandler } from '@/lib/jobs/dispatch';
import { elevenLabsHandler } from './elevenlabs';
import { klingHandler } from './kling';

// Side-effect: registra todos los handlers en el dispatcher. Importar este
// archivo (desde el worker route) garantiza que los handlers estén disponibles
// antes de la primera llamada a dispatchJob.
//
// Agregar nuevos providers aquí conforme se implementen (Veo).
registerHandler('elevenlabs', elevenLabsHandler);
registerHandler('kling', klingHandler);
