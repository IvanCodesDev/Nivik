import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirrors `apps/web/tsconfig.json` `paths` so web modules with `@/` imports are testable.
    alias: { '@': fileURLToPath(new URL('./apps/web', import.meta.url)) },
  },
  // Next.js needs `jsx: preserve` in apps/web/tsconfig.json; component tests need real JSX output.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['apps/**/*.test.{ts,tsx}', 'packages/**/*.test.{ts,tsx}', '.githooks/**/*.test.mjs'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**'],
    environment: 'node',
    passWithNoTests: false,
  },
});
