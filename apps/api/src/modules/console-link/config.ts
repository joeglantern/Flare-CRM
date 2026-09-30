/**
 * Where this stack's owner console link comes from (docs/21 section 4).
 *
 * The server's environment wins when it sets the link, so an operator can always pin or recover a
 * stack from the box itself. Otherwise the link an admin entered in the CRM is used. The trusted
 * console keys follow the same rule: the environment's list if it has one, else the stored list.
 */
import type { Env } from '../../config/env.js';
import { decryptJson } from '../../lib/crypto.js';
import type { Db } from '../../plugins/prisma.js';

/** Published whenever an admin changes the link, so both processes pick it up without a restart. */
export const CONSOLE_CONFIG_CHANNEL = 'console:config-changed';

export interface ConsoleCredentials {
  CONSOLE_URL: string;
  CONSOLE_STACK_ID: string;
  CONSOLE_STACK_SECRET: string;
}

export interface EffectiveConsole {
  managedBy: 'server' | 'admin' | null;
  credentials: ConsoleCredentials | null;
  publicKeys: string[];
  updatedAt: Date | null;
}

type ConfigEnv = Pick<
  Env,
  'CONSOLE_URL' | 'CONSOLE_STACK_ID' | 'CONSOLE_STACK_SECRET' | 'CONSOLE_PUBLIC_KEY' | 'SECRETS_KEY'
>;

export async function readConsoleConfig(db: Db, env: ConfigEnv): Promise<EffectiveConsole> {
  if (
    env.CONSOLE_URL !== undefined &&
    env.CONSOLE_STACK_ID !== undefined &&
    env.CONSOLE_STACK_SECRET !== undefined
  ) {
    return {
      managedBy: 'server',
      credentials: {
        CONSOLE_URL: env.CONSOLE_URL,
        CONSOLE_STACK_ID: env.CONSOLE_STACK_ID,
        CONSOLE_STACK_SECRET: env.CONSOLE_STACK_SECRET,
      },
      publicKeys: env.CONSOLE_PUBLIC_KEY,
      updatedAt: null,
    };
  }
  const row = await db.consoleLinkConfig.findUnique({ where: { id: 1 } });
  const publicKeys =
    env.CONSOLE_PUBLIC_KEY.length > 0 ? env.CONSOLE_PUBLIC_KEY : (row?.publicKeys ?? []);
  if (!row) return { managedBy: null, credentials: null, publicKeys, updatedAt: null };
  const { secret } = decryptJson(row.secretEncrypted, env.SECRETS_KEY) as { secret: string };
  return {
    managedBy: 'admin',
    credentials: {
      CONSOLE_URL: row.consoleUrl,
      CONSOLE_STACK_ID: row.stackId,
      CONSOLE_STACK_SECRET: secret,
    },
    publicKeys,
    updatedAt: row.updatedAt,
  };
}
