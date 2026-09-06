# 07 — Authentication & RBAC

Auth is **Better Auth** (self-hosted, MIT). It owns: users, credential accounts, sessions,
email verification, password reset, 2FA, roles/ban (admin plugin). We add CRM-specific fields
via `user.additionalFields` and enforce CRM permissions with Better Auth's access-control
statements plus our own record-level visibility scoping.

## 1. Configuration (`plugins/auth.ts`)

```ts
export const auth = betterAuth({
  appName: 'CRM',
  baseURL: env.APP_URL, // https://crm.example.com
  basePath: '/api/auth',
  secret: env.AUTH_SECRET, // ≥ 32 random bytes; rotation supported
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secondaryStorage: valkeyStorage, // session cache + rate-limit counters
  trustedOrigins: [env.APP_URL, ...(env.DEV_ORIGINS ?? [])],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    sendResetPassword: mailer.sendPasswordReset,
    revokeSessionsOnPasswordReset: true,
    disableSignUp: true, // users are created by admins only (single-tenant CRM)
  },
  emailVerification: {
    sendVerificationEmail: mailer.sendVerification,
    autoSignInAfterVerification: false,
  },
  session: {
    expiresIn: 60 * 60 * 12, // 12 h absolute
    updateAge: 60 * 60, // refresh at most hourly
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  advanced: {
    useSecureCookies: env.NODE_ENV === 'production',
    cookiePrefix: 'crm',
    ipAddress: { ipAddressHeaders: ['x-forwarded-for'] }, // Caddy sets it; trust only our proxy
    database: { generateId: () => uuidv7() },
  },
  rateLimit: {
    enabled: true,
    storage: 'secondary-storage',
    window: 60,
    max: 60,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/two-factor/verify': { window: 60, max: 5 },
      '/forget-password': { window: 300, max: 3 },
    },
  },
  user: {
    additionalFields: {
      extension: { type: 'string', required: false, unique: true, input: false },
      teamId: { type: 'string', required: false, input: false },
      phone: { type: 'string', required: false, input: false },
      timezone: { type: 'string', required: false, defaultValue: 'Africa/Nairobi', input: false },
      locale: { type: 'string', required: false, defaultValue: 'en', input: false },
      isActive: { type: 'boolean', required: false, defaultValue: true, input: false },
      avatarKey: { type: 'string', required: false, input: false },
    },
    changeEmail: { enabled: false }, // admins change emails via admin API (audited)
    deleteUser: { enabled: false }, // users are deactivated, never deleted (audit integrity)
  },
  plugins: [
    admin({ ac, roles, defaultRole: 'agent', adminRoles: ['admin'] }),
    twoFactor({ issuer: 'CRM', skipVerificationOnEnable: false }),
    haveIBeenPwned(),
    ...(env.NODE_ENV !== 'production' ? [openAPI()] : []),
    // sso({ ... })  — Phase 3 when the client provides an IdP
  ],
  databaseHooks: {
    session: {
      create: {
        before: async ({ userId }) => {
          /* reject if user.isActive=false or banned */
        },
      },
    },
  },
  hooks: { after: auditAuthEvents }, // sign-in/out, failed attempts, password change → audit_logs
});
```

`input: false` on additional fields means clients cannot set them at sign-up; they are managed through our `/api/v1/users` admin endpoints.

Mounting in Fastify (per Better Auth's Fastify guide): a catch-all `GET|POST /api/auth/*` route that converts the Fastify request to a Fetch `Request` (`fromNodeHeaders`), calls `auth.handler()`, and streams the response. A custom content-type parser passes the raw body through for `/api/auth/*` so Better Auth handles its own parsing. `@fastify/cors` (credentials `true`, restricted origin) is registered **before** this route.

Session on every request: `plugins/auth.ts` decorates `request.session` (via `auth.api.getSession({ headers })`, cached per request) and `request.user`. Unauthenticated → `401 UNAUTHENTICATED`.

## 2. Roles

| Role      | Intent                                                                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin`   | Full system access; user/role management; settings; PBX config; audit; all data                                                                                                                     |
| `manager` | Everything agents can do + all records of their **team** (or all records if `agentVisibility=all`), reports across the team, reassignment, pipeline/disposition configuration, listen to recordings |
| `agent`   | Own records (per `agentVisibility`), own calls/chats/tasks, create contacts/leads/deals/notes                                                                                                       |

Only `admin` can grant `admin`. Role changes revoke all sessions of the affected user.

## 3. Permission statement (`packages/shared/permissions.ts`)

```ts
export const statement = {
  ...defaultStatements, // Better Auth admin: user:*, session:*
  contact: [
    'create',
    'read',
    'update',
    'delete',
    'assign',
    'export',
    'import',
    'merge',
    'override_dnc',
  ],
  company: ['create', 'read', 'update', 'delete', 'assign', 'export'],
  lead: ['create', 'read', 'update', 'delete', 'assign', 'convert', 'import'],
  deal: ['create', 'read', 'update', 'delete', 'assign', 'change_stage', 'export'],
  pipeline: ['manage'],
  task: ['create', 'read', 'update', 'delete', 'assign'],
  note: ['create', 'read', 'update', 'delete'],
  call: [
    'read',
    'dial',
    'control',
    'webrtc',
    'set_disposition',
    'listen_recording',
    'delete_recording',
    'export',
  ],
  chat: ['read', 'send', 'assign', 'close'],
  channel: ['manage'],
  report: ['view_own', 'view_team', 'view_all', 'export'],
  notification: ['manage_own'],
  custom_field: ['manage'],
  settings: ['read', 'manage'],
  audit: ['read'],
  pbx: ['view_status', 'reconcile'],
  webform: ['manage'],
} as const;

export const ac = createAccessControl(statement);

export const roles = {
  agent: ac.newRole({
    contact: ['create', 'read', 'update', 'export'],
    company: ['create', 'read', 'update'],
    lead: ['create', 'read', 'update', 'convert'],
    deal: ['create', 'read', 'update', 'change_stage'],
    task: ['create', 'read', 'update', 'delete'],
    note: ['create', 'read', 'update', 'delete'],
    call: ['read', 'dial', 'control', 'set_disposition', 'listen_recording'], // listen gated by Setting.recording.allowAgentPlayback
    chat: ['read', 'send', 'close'],
    report: ['view_own'],
    notification: ['manage_own'],
    settings: ['read'],
  }),
  manager: ac.newRole({
    contact: [
      'create',
      'read',
      'update',
      'delete',
      'assign',
      'export',
      'import',
      'merge',
      'override_dnc',
    ],
    company: ['create', 'read', 'update', 'delete', 'assign', 'export'],
    lead: ['create', 'read', 'update', 'delete', 'assign', 'convert', 'import'],
    deal: ['create', 'read', 'update', 'delete', 'assign', 'change_stage', 'export'],
    pipeline: ['manage'],
    task: ['create', 'read', 'update', 'delete', 'assign'],
    note: ['create', 'read', 'update', 'delete'],
    call: ['read', 'dial', 'control', 'webrtc', 'set_disposition', 'listen_recording', 'export'],
    chat: ['read', 'send', 'assign', 'close'],
    report: ['view_own', 'view_team', 'export'],
    notification: ['manage_own'],
    custom_field: ['manage'],
    settings: ['read'],
    audit: ['read'],
    pbx: ['view_status'],
    user: ['list'],
  }),
  admin: ac.newRole({ ...adminAc.statements /* every resource, every action */ }),
};
```

Route guard: `preHandler: [requireAuth, requirePermission('deal', 'change_stage')]` → uses `auth.api.userHasPermission({ body: { userId, permissions } })` (role-based check; cached per request). Missing permission → `403 FORBIDDEN` with `{ required: 'deal:change_stage' }`.

## 4. Record-level visibility (R-7.5.2)

`Setting.agentVisibility` (admin-editable):

| Value             | agent sees                                                                                                                                                | manager sees                                    | admin |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----- |
| `owned` (default) | records where `owner_id = me` or `assignee_id = me`; plus records tied to _their own_ calls/chats (a contact that called them is visible even if unowned) | all records of users in their team + unassigned | all   |
| `team`            | records owned by anyone in my team + unassigned                                                                                                           | same as above                                   | all   |
| `all`             | everything (read); write still limited to own unless `assign` permission                                                                                  | all                                             | all   |

Implementation: `visibility.scope(actor, setting)` returns a descriptor `{ kind: 'all' } | { kind: 'team', userIds } | { kind: 'own', userId }`; every repository `findMany/findFirst` for scoped entities merges `scopeWhere(descriptor, entityOwnerField)` into the `where`. Direct `prisma.contact.findMany` in a service without the scope is a lint error (custom ESLint rule `no-unscoped-prisma`).

Applies to: contacts, companies, leads, deals, tasks, notes, calls, conversations, activities, reports. Does **not** apply to: dispositions, pipelines, custom field definitions, settings (global config).

Unknown caller pop: the popup is shown to the ringing agent regardless of visibility (they are receiving the call); if a matched contact is outside their scope, the payload is reduced to `{ displayName, company }` with `restricted: true` (no history) unless `agentVisibility=all`.

## 5. Session & cookie policy

- Cookie `crm.session_token`: `HttpOnly; Secure; SameSite=Lax; Path=/`. Single origin means no cross-site cookies.
- Absolute lifetime 12 h, sliding refresh hourly; idle logout in the SPA after 60 min without activity (client-side) — server enforces the 12 h cap.
- Admin can list and revoke any user's sessions (`user:*` via admin plugin); role change/ban/deactivation revokes all sessions.
- 2FA (TOTP) **required** for `admin` and `manager` (enforced by a `before` hook that returns `403 TWO_FACTOR_REQUIRED` for privileged routes until enabled). Optional for agents (admin can require globally via `Setting.security.require2FA`).
- Socket.IO handshake authenticates with the same cookie (see [10](10-realtime-contract.md)); a revoked session disconnects sockets within 30 s (session check on heartbeat).

## 6. User lifecycle (admin endpoints in `modules/users`)

| Action                        | Endpoint                                                   | Notes                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Create user                   | `POST /api/v1/users`                                       | admin creates with role, team, extension; Better Auth `admin.createUser` + welcome email with set-password link (never a plaintext password) |
| Update profile/extension/team | `PATCH /api/v1/users/:id`                                  | extension uniqueness validated; optionally verified against PBX `extension/list`                                                             |
| Change role                   | `POST /api/v1/users/:id/role`                              | admin only; audited; sessions revoked                                                                                                        |
| Deactivate / reactivate       | `POST /api/v1/users/:id/deactivate`                        | sets `isActive=false`, revokes sessions, unassigns from queues in UI; records keep owner for history; admin may bulk-reassign                |
| Ban                           | Better Auth admin `banUser`                                | for security incidents                                                                                                                       |
| Impersonate                   | disabled in production (`impersonationSessionDuration: 0`) | audit-hostile                                                                                                                                |

## 7. Password & account security

- scrypt hashing (Better Auth default) — do not override.
- Min 12 chars, breached-password rejection (HIBP k-anonymity), no composition rules beyond length (NIST 800-63B).
- Lockout: rate limit 5 sign-in attempts / minute / IP+email (Better Auth rule) plus progressive delay after 10 failures per account (custom hook) and audit entry `auth.sign_in_failed`.
- Password reset tokens: single-use, 15 min expiry (Better Auth `resetPasswordTokenExpiresIn: 900`).
- Email enumeration protection: identical responses for known/unknown emails (Better Auth default).
- All auth emails go through the `email` queue with templates in `modules/notifications/templates`.
