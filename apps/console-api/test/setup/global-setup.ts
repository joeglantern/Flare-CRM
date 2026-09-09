/**
 * Vitest global setup for integration tests (docs/14 §6): real PostgreSQL 17 + Valkey 8 via
 * Testcontainers, migrations applied with `prisma migrate deploy`.
 * Connection strings are passed to test files through environment variables.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let pg: StartedPostgreSqlContainer | undefined;
let valkey: StartedTestContainer | undefined;

export async function setup(): Promise<void> {
  pg = await new PostgreSqlContainer('postgres:17.11-alpine')
    .withDatabase('console_test')
    .withUsername('postgres')
    .withPassword('test')
    .start();
  valkey = await new GenericContainer('valkey/valkey:8.1-alpine')
    .withExposedPorts(6379)
    .withCommand(['valkey-server', '--maxmemory-policy', 'noeviction'])
    .start();

  const databaseUrl = pg.getConnectionUri();
  const valkeyUrl = `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}/0`;

  execFileSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'prisma', 'migrate', 'deploy'],
    {
      cwd: apiDir,
      env: { ...process.env, CONSOLE_DATABASE_URL: databaseUrl },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );

  process.env.TEST_CONSOLE_DATABASE_URL = databaseUrl;
  process.env.TEST_CONSOLE_VALKEY_URL = valkeyUrl;
}

export async function teardown(): Promise<void> {
  await valkey?.stop();
  await pg?.stop();
}
