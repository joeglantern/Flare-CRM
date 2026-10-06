/**
 * Email (SMTP) and PBX connection details, entered by an admin in Settings instead of the
 * server's .env. Passwords and API secrets are write-only: a status never carries them, and on an
 * existing setup a blank one means "keep the one in use".
 */
import { z } from 'zod';

const blankable = (max: number) => z.string().trim().max(max).optional();

export const smtpSecurity = z.enum(['tls', 'starttls', 'none']);
export type SmtpSecurity = z.infer<typeof smtpSecurity>;

export const smtpConfigBody = z
  .object({
    host: z
      .string()
      .trim()
      .min(1, 'Enter the mail server')
      .max(253)
      .regex(/^[A-Za-z0-9.-]+$/, 'A host name such as smtp.example.com, without https://'),
    port: z.number().int().min(1).max(65535),
    /** tls: encrypted from the start (usually 465). starttls: upgraded (587). none: local relays. */
    security: smtpSecurity,
    username: blankable(254),
    password: blankable(512),
    /** The sender people see, e.g. `Rani Africa CRM <crm@raniafrica.co.ke>`. */
    from: z.string().trim().min(3, 'Enter the sender address').max(320),
  })
  .strict();
export type SmtpConfigBody = z.infer<typeof smtpConfigBody>;

export const smtpStatusDto = z.object({
  /** Where the settings in use come from: entered here, the server's .env, or nowhere. */
  source: z.enum(['admin', 'server']),
  host: z.string().nullable(),
  port: z.number().int().nullable(),
  security: smtpSecurity.nullable(),
  username: z.string().nullable(),
  passwordSet: z.boolean(),
  from: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type SmtpStatusDto = z.infer<typeof smtpStatusDto>;

export const pbxTlsMode = z.enum(['public', 'fingerprint']);

const FINGERPRINT = /^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/;

export const pbxConfigBody = z
  .object({
    enabled: z.boolean(),
    /** The PBX web address, e.g. https://example.ras.yeastar.com or https://10.0.0.5:8088. */
    baseUrl: z
      .string()
      .trim()
      .max(300)
      .refine(
        (v) => /^https?:\/\//i.test(v) && z.url().safeParse(v).success,
        'Enter the full PBX address, starting with https://',
      ),
    clientId: z.string().trim().min(1, 'Enter the API client ID').max(200),
    clientSecret: blankable(500),
    /**
     * public: a certificate from a public authority (Yeastar Cloud and Remote Access).
     * fingerprint: a self-signed appliance, trusted by its SHA-256 fingerprint.
     */
    tls: pbxTlsMode,
    fingerprint: z
      .string()
      .trim()
      .max(200)
      .refine((v) => v === '' || FINGERPRINT.test(v), 'Paste the SHA-256 fingerprint, AA:BB:…')
      .optional(),
    /** Says the admin saw that saving reconnects the phone system for everyone. */
    confirmReconnect: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.tls === 'fingerprint' && (v.fingerprint ?? '') === '' && v.baseUrl.startsWith('https'))
      ctx.addIssue({
        code: 'custom',
        path: ['fingerprint'],
        message: 'Paste the certificate fingerprint, or choose a public certificate',
      });
  });
export type PbxConfigBody = z.infer<typeof pbxConfigBody>;

export const pbxStatusDto = z.object({
  source: z.enum(['admin', 'server']),
  enabled: z.boolean(),
  baseUrl: z.string().nullable(),
  clientId: z.string().nullable(),
  secretSet: z.boolean(),
  tls: pbxTlsMode.nullable(),
  fingerprint: z.string().nullable(),
  /** The event stream is up right now. */
  connected: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type PbxStatusDto = z.infer<typeof pbxStatusDto>;
