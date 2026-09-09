import { config as loadDotenv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 does not load .env by itself. The console keeps its own database, so its own URL.
loadDotenv({ path: ['../../.env', '.env'], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx --env-file-if-exists=../../.env prisma/seed.ts',
  },
  datasource: { url: env('CONSOLE_DATABASE_URL') },
});
