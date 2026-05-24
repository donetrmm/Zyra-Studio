import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', '.next', 'tests/integration/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // 'server-only' arroja al cargar en Node fuera de Next; lo aliasamos al
      // empty.js (mismo módulo que Next usa via condition `react-server`) para
      // que los módulos con `import 'server-only'` se puedan testear bajo vitest.
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
});
