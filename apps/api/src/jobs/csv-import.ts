/**
 * CSV import processor (R-7.1.5): maps columns, validates each row with the same Zod schemas
 * as the API, creates/updates through the services (dedupe, activity, audit all apply).
 */
import {
  createCompanyBody,
  createContactBody,
  createLeadBody,
  toE164,
  type ImportMapping,
} from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import type { CountryCode } from 'libphonenumber-js';
import { parseCsv } from '../lib/csv.js';
import { DuplicateError, ValidationError } from '../lib/errors.js';
import { CompaniesService } from '../modules/companies/companies.service.js';
import { ContactsService } from '../modules/contacts/contacts.service.js';
import { LeadsService } from '../modules/leads/leads.service.js';

const MAX_ERRORS = 500;

export async function runCsvImport(app: FastifyInstance, importJobId: string): Promise<void> {
  const job = await app.db.importJob.findUnique({ where: { id: importJobId } });
  if (job?.status !== 'queued') return;
  const mapping = job.mapping as ImportMapping;
  const obj = await app.storage.get(job.fileKey);
  if (!obj) {
    await app.db.importJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        errors: [{ row: 0, message: 'Uploaded file not found' }],
        finishedAt: new Date(),
      },
    });
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of obj.body)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  const parsed = parseCsv(Buffer.concat(chunks));
  const errors: { row: number; message: string }[] = [...parsed.errors];
  await app.db.importJob.update({
    where: { id: job.id },
    data: { status: 'running', totalRows: parsed.rows.length },
  });

  const scope = { kind: 'all' as const };
  const actor = { id: job.createdById, canAssign: true };
  const ctx = {
    actorId: job.createdById,
    actorType: 'system' as const,
    requestId: `import-${job.id}`,
  };
  const settings = await app.settings.getAll();
  const country = (mapping.country ?? settings.defaultCountry) as CountryCode;
  const contacts = new ContactsService(app);
  const companies = new CompaniesService(app);
  const leads = new LeadsService(app);

  let created = 0;
  let updated = 0;
  let processed = 0;

  const companyCache = new Map<string, string>();
  const resolveCompany = async (name: string | undefined): Promise<string | null> => {
    const trimmed = name?.trim() ?? '';
    const key = trimmed.toLowerCase();
    if (!key) return null;
    const cached = companyCache.get(key);
    if (cached) return cached;
    const found = await app.db.company.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' } },
      select: { id: true },
    });
    if (found) {
      companyCache.set(key, found.id);
      return found.id;
    }
    const dto = await companies.create(
      scope,
      actor,
      { name: trimmed, ownerId: mapping.ownerId ?? job.createdById },
      ctx,
    );
    companyCache.set(key, dto.id);
    return dto.id;
  };

  for (const [i, raw] of parsed.rows.entries()) {
    const rowNo = i + 2;
    const row: Record<string, string> = {};
    const custom: Record<string, unknown> = {};
    for (const [column, field] of Object.entries(mapping.columns)) {
      const value = raw[column]?.trim();
      if (value === undefined || value === '') continue;
      if (field.startsWith('cf:')) custom[field.slice(3)] = value;
      else row[field] = value;
    }
    try {
      if (job.entity === 'contact') {
        const phones = [row.phone, row.phone2]
          .filter((p): p is string => Boolean(p))
          .map((number) => ({ number, type: 'mobile' as const }));
        const body = createContactBody.parse({
          firstName: row.firstName ?? row.name ?? '',
          lastName: row.lastName ?? null,
          jobTitle: row.jobTitle ?? null,
          source: 'import',
          tags: [
            ...(mapping.tags ?? []),
            ...(row.tags
              ? row.tags
                  .split(';')
                  .map((t) => t.trim())
                  .filter(Boolean)
              : []),
          ],
          doNotCall: /^(true|yes|1)$/i.test(row.doNotCall ?? ''),
          phones,
          emails: row.email ? [{ email: row.email }] : [],
          customFields: custom,
          ownerId: mapping.ownerId ?? job.createdById,
          companyId: await resolveCompany(row.company),
        });
        try {
          await contacts.create(scope, actor, body, ctx);
          created++;
        } catch (err) {
          if (err instanceof DuplicateError && mapping.onDuplicate === 'update') {
            const match = (err.details as { matches: { contact: { id: string } }[] }).matches[0];
            if (match) {
              await contacts.update(
                scope,
                actor,
                match.contact.id,
                {
                  ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
                  ...(body.jobTitle !== undefined ? { jobTitle: body.jobTitle } : {}),
                  tags: body.tags,
                  customFields: body.customFields ?? {},
                  ...(body.companyId ? { companyId: body.companyId } : {}),
                },
                ctx,
              );
              updated++;
            }
          } else throw err;
        }
      } else if (job.entity === 'company') {
        const body = createCompanyBody.parse({
          name: row.name ?? '',
          industry: row.industry ?? null,
          website: row.website ?? null,
          phone: row.phone ?? null,
          email: row.email ?? null,
          address:
            row.city || row.country
              ? {
                  ...(row.city ? { city: row.city } : {}),
                  ...(row.country ? { country: row.country.toUpperCase().slice(0, 2) } : {}),
                }
              : null,
          ownerId: mapping.ownerId ?? job.createdById,
          customFields: custom,
        });
        const existing = await app.db.company.findFirst({
          where: { name: { equals: body.name, mode: 'insensitive' } },
          select: { id: true },
        });
        if (existing) {
          if (mapping.onDuplicate === 'update') {
            await companies.update(scope, actor, existing.id, body, ctx);
            updated++;
          } else throw new DuplicateError('Company already exists', [{ id: existing.id }]);
        } else {
          await companies.create(scope, actor, body, ctx);
          created++;
        }
      } else {
        if (row.phone && !toE164(row.phone, country))
          throw new ValidationError([{ path: 'phone', message: 'Invalid phone number' }]);
        const body = createLeadBody.parse({
          firstName: row.firstName ?? row.name ?? '',
          lastName: row.lastName ?? null,
          companyName: row.companyName ?? row.company ?? null,
          phone: row.phone ?? null,
          email: row.email ?? null,
          source: 'import',
          sourceRef: job.id,
          notes: row.notes ?? null,
          customFields: custom,
        });
        await leads.createRaw(body, job.createdById, mapping.ownerId ?? job.createdById, ctx);
        created++;
      }
    } catch (err) {
      if (errors.length < MAX_ERRORS) errors.push({ row: rowNo, message: describe(err) });
    }
    processed++;
    if (processed % 200 === 0)
      await app.db.importJob.update({
        where: { id: job.id },
        data: {
          processedRows: processed,
          createdRows: created,
          updatedRows: updated,
          errorRows: errors.length,
        },
      });
  }

  await app.db.importJob.update({
    where: { id: job.id },
    data: {
      status: 'done',
      processedRows: processed,
      createdRows: created,
      updatedRows: updated,
      errorRows: errors.length,
      errors: errors as object[],
      finishedAt: new Date(),
    },
  });
  await app.storage.delete(job.fileKey).catch(() => undefined);
  await app.notifications.notify({
    userId: job.createdById,
    type: 'system',
    title: `Import finished: ${created} created, ${updated} updated, ${errors.length} errors`,
    body: null,
    data: { importJobId: job.id, url: `/imports/${job.id}` },
  });
}

function describe(err: unknown): string {
  if (err instanceof ValidationError) {
    const details = err.details as { path: string; message: string }[] | undefined;
    return details?.map((d) => `${d.path}: ${d.message}`).join('; ') ?? err.message;
  }
  if (err instanceof DuplicateError) return 'Duplicate (phone/email already exists)';
  if (err && typeof err === 'object' && 'issues' in err) {
    const issues = (err as { issues: { path: PropertyKey[]; message: string }[] }).issues;
    return issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  }
  return err instanceof Error ? err.message : String(err);
}
