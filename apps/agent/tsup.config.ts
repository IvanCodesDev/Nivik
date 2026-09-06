import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  // Workspace packages ship TypeScript sources, so they must be bundled into the runtime.
  noExternal: [/^@nivik\//],
  sourcemap: true,
  clean: true,
});
