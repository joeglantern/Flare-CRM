/**
 * Signs an entitlements document with a throwaway key, for trying file mode by hand:
 *
 *   pnpm --filter @crm/api exec tsx test/setup/sign-cli.ts --telephony=false --seats=2 --expires=2027-01-01
 *
 * Prints the envelope to stdout and the matching CONSOLE_PUBLIC_KEY line to stderr. Every
 * feature defaults to on and every limit to unlimited; pass --<feature>=false or --<limit>=<n>.
 */
import { featureKeys, limitKeys, type FeatureKey, type LimitKey } from '@crm/shared';
import { createSigner, type DocumentOverrides } from './signing.js';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k ?? '', v ?? 'true'] as const;
  }),
);

const overrides: DocumentOverrides = { features: {}, limits: {} };
for (const [k, v] of args) {
  if ((featureKeys as string[]).includes(k)) overrides.features![k as FeatureKey] = v !== 'false';
  else if ((limitKeys as string[]).includes(k)) overrides.limits![k as LimitKey] = Number(v);
  else if (k === 'expires') overrides.expiresAt = new Date(v).toISOString();
  else if (k === 'audience') overrides.audience = v;
  else if (k === 'customer') overrides.customerName = v;
}

const signer = createSigner();
process.stdout.write(`${JSON.stringify(signer.sign(signer.document(overrides)), null, 2)}\n`);
process.stderr.write(`CONSOLE_PUBLIC_KEY=${signer.publicKeyBase64}\n`);
