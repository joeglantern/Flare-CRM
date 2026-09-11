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
    // register-customer ships for the same reason: the provider's own stack has to be registered
    // on a console nobody can sign in to yet, and issue-document is how that stack is then served.
    'register-customer': 'src/scripts/register-customer.ts',
    'issue-document': 'src/scripts/issue-document.ts',
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
