import 'server-only';
import type { GenerationRow, JobAction, JobHandler, JobResult } from './handlers/types';

// Map provider → handler. Cada handler vive en lib/jobs/handlers/<provider>.ts.
// Por ahora son placeholders que devuelven fail; se llenan en tareas posteriores.
const handlers: Partial<Record<GenerationRow['provider'], JobHandler>> = {};

export function registerHandler(provider: GenerationRow['provider'], handler: JobHandler): void {
  handlers[provider] = handler;
}

export async function dispatchJob(
  gen: GenerationRow,
  action: JobAction,
): Promise<JobResult> {
  const handler = handlers[gen.provider];
  if (!handler) {
    return {
      kind: 'fail',
      message: `provider ${gen.provider} no soportado en el worker`,
      code: 'unknown',
    };
  }
  return handler.handle(gen, action);
}

export async function dispatchCancel(gen: GenerationRow): Promise<void> {
  const handler = handlers[gen.provider];
  if (!handler?.cancel) return; // no-op para providers sin cancel remoto
  await handler.cancel(gen);
}
