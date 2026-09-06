import { config as loadDotenv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 does not load .env by itself. The repo-level .env is the single dev config file.
loadDotenv({ path: ['../../.env', '.env'], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx --env-file-if-exists=../../.env prisma/seed.ts',
  },
  datasource: {
    // migrations use the DDL role when provided (docs/08 M1); the app itself uses DATABASE_URL
    url: process.env.DATABASE_URL_MIGRATE ?? env('DATABASE_URL'),
  },
});
