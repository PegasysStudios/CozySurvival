import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    port: 5287,
    strictPort: true,
    host: true,
  },
  preview: {
    port: 5288,
    strictPort: true,
    host: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
