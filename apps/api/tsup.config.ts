import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'entry/api': 'src/entry/api.ts', 'entry/worker': 'src/entry/worker.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  // bundle the workspace package; keep everything else as external node_modules
  noExternal: ['@crm/shared'],
  outDir: 'dist',
});
