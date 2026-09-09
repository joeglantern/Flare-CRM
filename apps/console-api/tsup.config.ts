import { defineConfig } from 'tsup';

export default defineConfig({
  // The seed ships compiled: the runtime image carries production dependencies only, so there is
  // no TypeScript runner in it to execute prisma/seed.ts.
  entry: { 'entry/api': 'src/entry/api.ts', seed: 'prisma/seed.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: ['@crm/shared'],
  outDir: 'dist',
});
