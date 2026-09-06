/**
 * TLS options for talking to the PBX (docs/06 §2, docs/08 §N). Self-signed PBX certificates are
 * trusted by providing the certificate itself as the CA and pinning its SHA-256 fingerprint;
 * verification is never disabled.
 */
import { readFileSync } from 'node:fs';
import type { PeerCertificate } from 'node:tls';

export interface PbxTlsOptions {
  ca?: string[];
  checkServerIdentity?: (hostname: string, cert: PeerCertificate) => Error | undefined;
}

export function buildPbxTlsOptions(opts: {
  caFile?: string | undefined;
  fingerprintSha256?: string | undefined;
}): PbxTlsOptions {
  const out: PbxTlsOptions = {};
  if (opts.caFile) out.ca = [readFileSync(opts.caFile, 'utf8')];
  if (opts.fingerprintSha256) {
    const expected = opts.fingerprintSha256.toUpperCase();
    // hostname/IP mismatch on the PBX cert is tolerated only when the pin matches
    out.checkServerIdentity = (_hostname, cert) =>
      cert.fingerprint256.toUpperCase() === expected
        ? undefined
        : new Error(`PBX certificate fingerprint mismatch (got ${cert.fingerprint256})`);
  }
  return out;
}
