/**
 * Writes the OpenAPI document generated from the Zod route schemas to docs/openapi.json
 * (docs/09 §6). The frontend generates its API types from that file (`pnpm openapi:types`).
 * Boots the app with OpenAPI forced on and logging off; needs the dev database and Valkey.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';

async function main(): Promise<void> {
  const env = loadEnv({ ...process.env, OPENAPI_ENABLED: 'true', LOG_LEVEL: 'silent' });
  const app = await buildApp({ env, logger: false });
  await app.ready();
  const document = app.swagger();
  const target = resolve(process.argv[2] ?? '../../docs/openapi.json');
  mkdirSync(resolve(target, '..'), { recursive: true });
  writeFileSync(target, JSON.stringify(document, null, 2) + '\n');
  const pathCount = Object.keys(document.paths ?? {}).length;
  await app.close();
  // eslint-disable-next-line no-console
  console.log(`OpenAPI written to ${target} (${String(pathCount)} paths)`);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
