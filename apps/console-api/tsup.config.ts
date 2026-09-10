import { defineConfig } from 'tsup';

export default defineConfig({
  // The seed ships compiled: the runtime image carries production dependencies only, so there is
  // no TypeScript runner in it to execute prisma/seed.ts.
  // create-owner ships too: it is how the first owner comes into being on a fresh console, and
  // there is no TypeScript runner in the image to execute the source.
  entry: {
    'entry/api': 'src/entry/api.ts',
    seed: 'prisma/seed.ts',
    'create-owner': 'src/scripts/create-owner.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: ['@crm/shared'],
  outDir: 'dist',
});
