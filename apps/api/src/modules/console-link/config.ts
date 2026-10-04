/**
 * Where this stack's owner console link comes from (docs/21 section 4).
 *
 * A link an admin saved in the CRM is used when there is one; otherwise the server's environment;
 * otherwise the stack runs standalone. The admin's link takes precedence because it is the newer
 * decision, and it can be dropped again to fall back to the server's. An operator who wants the
 * environment to be the only word sets CONSOLE_LINK_LOCKED, which ignores the saved link and makes
 * the CRM screen read-only.
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
  /** The environment pins the link; nothing saved in the CRM is used or accepted. */
  locked: boolean;
  /** The environment carries a complete link of its own, to fall back to. */
  serverLinkAvailable: boolean;
}

type ConfigEnv = Pick<
  Env,
  | 'CONSOLE_URL'
  | 'CONSOLE_STACK_ID'
  | 'CONSOLE_STACK_SECRET'
  | 'CONSOLE_PUBLIC_KEY'
  | 'CONSOLE_LINK_LOCKED'
  | 'SECRETS_KEY'
>;

function fromEnv(env: ConfigEnv): ConsoleCredentials | null {
  if (
    env.CONSOLE_URL === undefined ||
    env.CONSOLE_STACK_ID === undefined ||
    env.CONSOLE_STACK_SECRET === undefined
  ) {
    return null;
  }
  return {
    CONSOLE_URL: env.CONSOLE_URL,
    CONSOLE_STACK_ID: env.CONSOLE_STACK_ID,
    CONSOLE_STACK_SECRET: env.CONSOLE_STACK_SECRET,
  };
}

export async function readConsoleConfig(db: Db, env: ConfigEnv): Promise<EffectiveConsole> {
  const server = fromEnv(env);
  const locked = env.CONSOLE_LINK_LOCKED;
  const serverLinkAvailable = server !== null;
  const row = locked ? null : await db.consoleLinkConfig.findUnique({ where: { id: 1 } });
  if (row) {
    const { secret } = decryptJson(row.secretEncrypted, env.SECRETS_KEY) as { secret: string };
    return {
      managedBy: 'admin',
      credentials: {
        CONSOLE_URL: row.consoleUrl,
        CONSOLE_STACK_ID: row.stackId,
        CONSOLE_STACK_SECRET: secret,
      },
      publicKeys: row.publicKeys.length > 0 ? row.publicKeys : env.CONSOLE_PUBLIC_KEY,
      updatedAt: row.updatedAt,
      locked,
      serverLinkAvailable,
    };
  }
  return {
    managedBy: server ? 'server' : null,
    credentials: server,
    publicKeys: env.CONSOLE_PUBLIC_KEY,
    updatedAt: null,
    locked,
    serverLinkAvailable,
  };
}
