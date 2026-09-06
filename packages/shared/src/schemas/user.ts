import { z } from 'zod';
import { Role, valuesOf } from '../enums.js';
import { emailSchema, isoDateTime, phoneInput, uuid } from './common.js';

export const roleSchema = z.enum(valuesOf(Role));

export const userDto = z.object({
  id: uuid,
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  role: roleSchema,
  extension: z.string().nullable(),
  teamId: uuid.nullable(),
  team: z.object({ id: uuid, name: z.string() }).nullable(),
  phone: z.string().nullable(),
  timezone: z.string(),
  locale: z.string(),
  isActive: z.boolean(),
  banned: z.boolean(),
  twoFactorEnabled: z.boolean(),
  avatarUrl: z.string().nullable(),
  lastSeenAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type UserDto = z.infer<typeof userDto>;

/** What every authenticated user gets about themselves, including effective permissions. */
export const meDto = userDto.extend({
  permissions: z.array(z.string()),
});
export type MeDto = z.infer<typeof meDto>;

export const extensionSchema = z
  .string()
  .trim()
  .regex(/^\d{2,8}$/, 'Extension must be 2–8 digits');

export const createUserBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: emailSchema,
    role: roleSchema.default('agent'),
    extension: extensionSchema.nullable().optional(),
    teamId: uuid.nullable().optional(),
    phone: phoneInput.nullable().optional(),
    timezone: z.string().max(64).optional(),
    locale: z.string().max(10).optional(),
  })
  .strict();
export type CreateUserBody = z.infer<typeof createUserBody>;

export const updateUserBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    extension: extensionSchema.nullable().optional(),
    teamId: uuid.nullable().optional(),
    phone: phoneInput.nullable().optional(),
    timezone: z.string().max(64).optional(),
    locale: z.string().max(10).optional(),
  })
  .strict();
export type UpdateUserBody = z.infer<typeof updateUserBody>;

export const updateMeBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: phoneInput.nullable().optional(),
    timezone: z.string().max(64).optional(),
    locale: z.string().max(10).optional(),
  })
  .strict();

export const setRoleBody = z.object({ role: roleSchema }).strict();

export const listUsersQuery = z.object({
  q: z.string().trim().max(120).optional(),
  role: roleSchema.optional(),
  teamId: uuid.optional(),
  isActive: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const teamDto = z.object({
  id: uuid,
  name: z.string(),
  managerId: uuid.nullable(),
  manager: z.object({ id: uuid, name: z.string() }).nullable(),
  memberCount: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type TeamDto = z.infer<typeof teamDto>;

export const createTeamBody = z
  .object({ name: z.string().trim().min(1).max(80), managerId: uuid.nullable().optional() })
  .strict();
export const updateTeamBody = createTeamBody.partial().strict();
export const teamMembersBody = z.object({ userIds: z.array(uuid).min(1).max(200) }).strict();
