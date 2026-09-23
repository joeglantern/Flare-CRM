/**
 * Which CRM user is which PBX extension, decided by email (docs/06 §18).
 *
 * This is the rule Yeastar's own CRM integration applies with its "Associate Automatically" button:
 * an extension and a user account carrying the same email address are the same person. The CRM
 * used to learn an extension only by somebody typing it into a user's profile, and a blank or
 * mistyped one failed silently: that person's calls popped for nobody and were logged against
 * nobody, and nothing said why. Email is something both systems already hold for every person, so
 * it is the one key that needs no maintenance.
 *
 * Both the popup and the call log read the extension map, so getting this right fixes both at
 * once, and they cannot drift apart because there is only one place either of them looks.
 *
 * Only the unambiguous case is acted on: one extension with this email, one user with this email,
 * the user has no extension yet, and nobody else holds that extension. Everything else is reported
 * with enough detail for a person to settle it. Guessing here means somebody's calls going to the
 * wrong desk, which is worse than a blank.
 */

export interface PbxExtension {
  number: string;
  name: string | null;
  email: string | null;
}

export interface CrmUser {
  id: string;
  name: string;
  email: string;
  extension: string | null;
}

export type ConflictKind =
  'extension_taken' | 'extension_differs' | 'ambiguous_email' | 'extension_not_on_pbx';

export interface Conflict {
  kind: ConflictKind;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  extension: string | null;
  pbxExtension: string | null;
  detail: string;
}

export interface LinkPlan {
  /** Same email, same extension already: nothing to do. */
  matched: number;
  assign: { userId: string; userName: string; extension: string }[];
  conflicts: Conflict[];
  unmatchedExtensions: PbxExtension[];
  usersWithoutExtension: { userId: string; userName: string; email: string }[];
}

const norm = (email: string | null | undefined): string | null => {
  const e = (email ?? '').trim().toLowerCase();
  return e === '' ? null : e;
};

export function planExtensionLinks(pbx: PbxExtension[], users: CrmUser[]): LinkPlan {
  const plan: LinkPlan = {
    matched: 0,
    assign: [],
    conflicts: [],
    unmatchedExtensions: [],
    usersWithoutExtension: [],
  };

  const byEmail = new Map<string, PbxExtension[]>();
  for (const ext of pbx) {
    const e = norm(ext.email);
    if (e === null) continue;
    byEmail.set(e, [...(byEmail.get(e) ?? []), ext]);
  }
  const pbxNumbers = new Set(pbx.map((x) => x.number));
  const holder = new Map<string, CrmUser>();
  for (const u of users) if (u.extension) holder.set(u.extension, u);

  /** PBX extensions that some user ended up tied to, so the leftovers can be listed. */
  const claimed = new Set<string>();

  for (const user of users) {
    const email = norm(user.email);
    const matches = email === null ? [] : (byEmail.get(email) ?? []);

    if (matches.length > 1) {
      plan.conflicts.push({
        kind: 'ambiguous_email',
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        extension: user.extension,
        pbxExtension: matches.map((m) => m.number).join(', '),
        detail: `${user.email} is on ${String(matches.length)} PBX extensions, so which one is theirs cannot be told from email alone`,
      });
      for (const m of matches) claimed.add(m.number);
      continue;
    }

    const match = matches[0];
    if (match === undefined) {
      if (user.extension !== null && !pbxNumbers.has(user.extension)) {
        plan.conflicts.push({
          kind: 'extension_not_on_pbx',
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          extension: user.extension,
          pbxExtension: null,
          detail: `Extension ${user.extension} is set on ${user.name} but the PBX has no such extension`,
        });
      } else if (user.extension === null) {
        plan.usersWithoutExtension.push({
          userId: user.id,
          userName: user.name,
          email: user.email,
        });
      } else {
        // An extension typed in by hand that the PBX confirms exists, with no email to check it
        // against. Left as it is: there is no evidence it is wrong.
        claimed.add(user.extension);
      }
      continue;
    }

    claimed.add(match.number);
    if (user.extension === match.number) {
      plan.matched++;
      continue;
    }
    if (user.extension !== null) {
      plan.conflicts.push({
        kind: 'extension_differs',
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        extension: user.extension,
        pbxExtension: match.number,
        detail: `${user.name} is set to ${user.extension} here, but the PBX has their email on ${match.number}`,
      });
      continue;
    }
    const other = holder.get(match.number);
    if (other !== undefined && other.id !== user.id) {
      plan.conflicts.push({
        kind: 'extension_taken',
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        extension: null,
        pbxExtension: match.number,
        detail: `The PBX has ${user.email} on ${match.number}, but ${other.name} already holds that extension here`,
      });
      continue;
    }
    plan.assign.push({ userId: user.id, userName: user.name, extension: match.number });
    // So a second user with the same email in the same run is reported, not also assigned.
    holder.set(match.number, user);
  }

  for (const ext of pbx) {
    if (!claimed.has(ext.number) && !holder.has(ext.number)) plan.unmatchedExtensions.push(ext);
  }

  return plan;
}
