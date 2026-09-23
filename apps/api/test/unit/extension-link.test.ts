/**
 * The rule that ties a CRM user to a PBX extension by email, and the cases where it must refuse
 * to guess. Guessing wrong here sends somebody's calls to the wrong desk and logs them against the
 * wrong person, which is quieter and worse than a blank.
 */
import { describe, expect, it } from 'vitest';
import {
  planExtensionLinks,
  type CrmUser,
  type PbxExtension,
} from '../../src/integrations/yeastar/extension-link.js';

const ext = (
  number: string,
  email: string | null = null,
  name: string | null = null,
): PbxExtension => ({
  number,
  email,
  name,
});
const user = (id: string, email: string, extension: string | null = null, name = id): CrmUser => ({
  id,
  name,
  email,
  extension,
});

describe('tying users to extensions by email', () => {
  it('fills in a blank extension when exactly one PBX extension carries that email', () => {
    const plan = planExtensionLinks(
      [ext('205', 'liban@example.com')],
      [user('u1', 'liban@example.com')],
    );
    expect(plan.assign).toEqual([{ userId: 'u1', userName: 'u1', extension: '205' }]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.usersWithoutExtension).toEqual([]);
  });

  it('matches email regardless of case and surrounding spaces', () => {
    const plan = planExtensionLinks(
      [ext('205', ' Liban@Example.com ')],
      [user('u1', 'liban@example.com')],
    );
    expect(plan.assign).toHaveLength(1);
  });

  it('counts an extension that already agrees, and changes nothing', () => {
    const plan = planExtensionLinks(
      [ext('200', 'joe@example.com')],
      [user('u1', 'joe@example.com', '200')],
    );
    expect(plan.matched).toBe(1);
    expect(plan.assign).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('is idempotent: after assigning, the next run finds it matched', () => {
    const pbx = [ext('205', 'liban@example.com')];
    const first = planExtensionLinks(pbx, [user('u1', 'liban@example.com')]);
    const applied = first.assign.map((a) => user(a.userId, 'liban@example.com', a.extension));
    const second = planExtensionLinks(pbx, applied);
    expect(second.matched).toBe(1);
    expect(second.assign).toEqual([]);
  });

  /** A person's calls must never be moved by a sync. */
  it('never overwrites an extension somebody set, even when the PBX disagrees', () => {
    const plan = planExtensionLinks(
      [ext('205', 'liban@example.com')],
      [user('u1', 'liban@example.com', '300')],
    );
    expect(plan.assign).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ kind: 'extension_differs', extension: '300', pbxExtension: '205' }),
    ]);
  });

  it('refuses to give one extension to two users', () => {
    const plan = planExtensionLinks(
      [ext('205', 'liban@example.com')],
      [user('u0', 'other@example.com', '205', 'Other'), user('u1', 'liban@example.com')],
    );
    expect(plan.assign).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ kind: 'extension_taken', userId: 'u1', pbxExtension: '205' }),
    ]);
  });

  it('refuses when the same email is on more than one extension', () => {
    const plan = planExtensionLinks(
      [ext('205', 'liban@example.com'), ext('206', 'liban@example.com')],
      [user('u1', 'liban@example.com')],
    );
    expect(plan.assign).toEqual([]);
    expect(plan.conflicts[0]?.kind).toBe('ambiguous_email');
    expect(plan.unmatchedExtensions).toEqual([]);
  });

  it('flags an extension set here that the PBX does not have', () => {
    const plan = planExtensionLinks(
      [ext('200', 'joe@example.com')],
      [user('u1', 'x@example.com', '999')],
    );
    expect(plan.conflicts[0]?.kind).toBe('extension_not_on_pbx');
  });

  it('keeps a hand-typed extension the PBX confirms, even with no email to check', () => {
    const plan = planExtensionLinks([ext('200')], [user('u1', 'joe@example.com', '200')]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.unmatchedExtensions).toEqual([]);
  });

  it('lists who is left over on each side', () => {
    const plan = planExtensionLinks(
      [ext('200', 'joe@example.com'), ext('210', 'nobody@example.com', 'Reception'), ext('211')],
      [user('u1', 'joe@example.com', '200'), user('u2', 'new@example.com')],
    );
    expect(plan.unmatchedExtensions.map((e) => e.number)).toEqual(['210', '211']);
    expect(plan.usersWithoutExtension).toEqual([
      { userId: 'u2', userName: 'u2', email: 'new@example.com' },
    ]);
  });

  it('assigns the first of two users sharing an email and reports the second', () => {
    const plan = planExtensionLinks(
      [ext('205', 'shared@example.com')],
      [user('u1', 'shared@example.com'), user('u2', 'shared@example.com')],
    );
    expect(plan.assign).toEqual([expect.objectContaining({ userId: 'u1' })]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ kind: 'extension_taken', userId: 'u2' }),
    ]);
  });
});
