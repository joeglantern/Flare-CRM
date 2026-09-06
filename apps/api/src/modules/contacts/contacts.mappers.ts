import { formatNational, type ContactDto, type ContactSummaryDto } from '@crm/shared';
import { isoOrNull, jsonObject } from '../../lib/object.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const AVATAR_URL_PREFIX = '/api/v1/files/';

export function avatarUrl(key: string | null): string | null {
  return key ? `${AVATAR_URL_PREFIX}${encodeURIComponent(key)}` : null;
}

export const contactSelect = {
  id: true,
  firstName: true,
  lastName: true,
  displayName: true,
  companyId: true,
  company: { select: { id: true, name: true } },
  jobTitle: true,
  avatarKey: true,
  ownerId: true,
  owner: { select: { id: true, name: true } },
  source: true,
  tags: true,
  customFields: true,
  preferredChannel: true,
  doNotCall: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  phones: {
    where: { deletedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, e164: true, raw: true, type: true, isPrimary: true },
  },
  emails: {
    where: { deletedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, email: true, isPrimary: true },
  },
} satisfies Prisma.ContactSelect;

export interface ContactRow {
  id: string;
  firstName: string;
  lastName: string | null;
  displayName: string;
  companyId: string | null;
  company: { id: string; name: string } | null;
  jobTitle: string | null;
  avatarKey: string | null;
  ownerId: string | null;
  owner: { id: string; name: string } | null;
  source: string;
  tags: string[];
  customFields: unknown;
  preferredChannel: string | null;
  doNotCall: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  phones: { id: string; e164: string; raw: string; type: string; isPrimary: boolean }[];
  emails: { id: string; email: string; isPrimary: boolean }[];
}

export function contactToDto(r: ContactRow): ContactDto {
  return {
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    displayName: r.displayName,
    company: r.company,
    companyId: r.companyId,
    jobTitle: r.jobTitle,
    avatarUrl: avatarUrl(r.avatarKey),
    owner: r.owner,
    ownerId: r.ownerId,
    source: r.source as ContactDto['source'],
    tags: r.tags,
    customFields: jsonObject(r.customFields),
    preferredChannel: r.preferredChannel,
    doNotCall: r.doNotCall,
    phones: r.phones.map((p) => ({
      id: p.id,
      e164: p.e164,
      raw: p.raw,
      display: formatNational(p.e164),
      type: p.type as ContactDto['phones'][number]['type'],
      isPrimary: p.isPrimary,
    })),
    emails: r.emails.map((e) => ({ id: e.id, email: e.email, isPrimary: e.isPrimary })),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: isoOrNull(r.deletedAt),
  };
}

export const contactSummarySelect = {
  id: true,
  displayName: true,
  company: { select: { id: true, name: true } },
  ownerId: true,
  avatarKey: true,
  tags: true,
  doNotCall: true,
  updatedAt: true,
  phones: {
    where: { deletedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    take: 1,
    select: { e164: true },
  },
  emails: {
    where: { deletedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    take: 1,
    select: { email: true },
  },
} satisfies Prisma.ContactSelect;

export function contactToSummary(r: {
  id: string;
  displayName: string;
  company: { id: string; name: string } | null;
  ownerId: string | null;
  avatarKey: string | null;
  tags: string[];
  doNotCall: boolean;
  updatedAt: Date;
  phones: { e164: string }[];
  emails: { email: string }[];
}): ContactSummaryDto {
  return {
    id: r.id,
    displayName: r.displayName,
    company: r.company,
    primaryPhone: r.phones[0]?.e164 ?? null,
    primaryEmail: r.emails[0]?.email ?? null,
    ownerId: r.ownerId,
    avatarUrl: avatarUrl(r.avatarKey),
    tags: r.tags,
    doNotCall: r.doNotCall,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function displayNameOf(firstName: string, lastName: string | null | undefined): string {
  return [firstName.trim(), (lastName ?? '').trim()].filter(Boolean).join(' ');
}
