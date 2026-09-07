import { defineConfig } from 'tsup';

export default defineConfig({
  // The seed ships compiled too. The runtime image carries production dependencies only, so
  // there is no TypeScript runner in it and prisma/seed.ts could not be executed on a server.
  // Its entry guard matches seed.js, so the built file runs the same way the source does.
  entry: {
    'entry/api': 'src/entry/api.ts',
    'entry/worker': 'src/entry/worker.ts',
    seed: 'prisma/seed.ts',
    'provision-user': 'src/scripts/provision-user.ts',
  },
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
