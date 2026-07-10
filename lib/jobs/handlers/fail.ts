import type { ProviderError } from '@/lib/providers/types';

export type FailCode = 'safety' | 'rate_limit' | 'timeout' | 'unknown';

// Traduce el código de un ProviderError al enum de fail del worker: safety,
// rate_limit y timeout pasan directo; cualquier otro código del provider
// (server, auth, invalid_input…) colapsa a 'unknown' — no son estados de fail
// del worker. Fuente única del mapeo que antes se duplicaba inline en cada
// handler (veo, seedance, kling, elevenlabs, nano-banana, image-turn).
export function mapProviderCode(err: ProviderError): FailCode {
  if (err.code === 'safety') return 'safety';
  if (err.code === 'rate_limit') return 'rate_limit';
  if (err.code === 'timeout') return 'timeout';
  return 'unknown';
}
