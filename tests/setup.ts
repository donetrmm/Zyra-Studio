// Setup compartido para tests unitarios. Las variables de entorno reales
// no se cargan aquí; cada test que necesite env vars las debe mockear o
// la función bajo test debe permitir inyección.
import { afterEach, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});
