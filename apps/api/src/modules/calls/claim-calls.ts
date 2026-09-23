/**
 * Gives every call from a number to the contact who now owns that number (docs/06 section 17).
 *
 * A caller nobody had saved is logged as an unknown number. When somebody later saves them, the
 * calls they already made should read as theirs too, on the call log and on their timeline, rather
 * than staying "Unknown number" for ever while only the next call gets the name.
 *
 * Only calls with no contact are touched. A call somebody linked by hand is a decision, and a
 * number is never better evidence than a person. The CRM's partial unique index allows one live
 * contact per number, so there is never a choice between two people to make here.
 *
 * Run inline where a contact gains a number through the contacts service, so the call log is right
 * the moment the form closes, and as a sweep from the worker, which covers every other way a number
 * arrives (CSV import, lead conversion, the PBX phonebook) without each of them having to remember.
 */
import { Prisma } from '../../generated/prisma/client.js';

type SqlRunner = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * Attaches unclaimed calls to the contact holding their number, and those calls' timeline entries
 * with them. Pass contact ids to limit it to those contacts; pass nothing to sweep everything.
 * Returns how many calls were claimed.
 */
export async function claimPastCalls(db: SqlRunner, contactIds?: string[]): Promise<number> {
  if (contactIds?.length === 0) return 0;
  const only =
    contactIds === undefined
      ? Prisma.empty
      : Prisma.sql`AND p.contact_id = ANY(${contactIds}::uuid[])`;
  // Data-modifying CTEs always run to completion, so the timeline update happens whether or not
  // the final SELECT reads from it, and both see the same set of claimed calls.
  const [row] = await db.$queryRaw<{ calls: number }[]>`
    WITH claimed AS (
      UPDATE calls k
         SET contact_id = p.contact_id, updated_at = now()
        FROM contact_phones p
        JOIN contacts c ON c.id = p.contact_id
       WHERE k.contact_id IS NULL
         AND k.external_e164 = p.e164
         AND p.deleted_at IS NULL
         AND c.deleted_at IS NULL
         ${only}
      RETURNING k.id, p.contact_id, c.company_id
    ), timeline AS (
      UPDATE activities a
         SET contact_id = claimed.contact_id, company_id = claimed.company_id
        FROM claimed
       WHERE a.ref_table = 'calls' AND a.ref_id = claimed.id AND a.contact_id IS NULL
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM claimed)::int AS calls`;
  return row?.calls ?? 0;
}
