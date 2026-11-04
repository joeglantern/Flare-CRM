/**
 * Anyone answering a customer needs to know what happened on earlier calls, so a contact's call
 * journal is open to everyone who can open the contact. It stops there: the agent's own Calls list,
 * calls with no contact, recording playback and writes keep their limits.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, type TestUser } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

describe('contact call journal', () => {
  let ctx: TestContext;
  let agentA: TestUser;
  let agentB: TestUser;
  let contactId: string;

  const call = async (
    over: { userId?: string | null; contactId?: string | null; recorded?: boolean } = {},
  ): Promise<string> => {
    const id = crypto.randomUUID();
    await ctx.app.db.call.create({
      data: {
        id,
        pbxCallId: crypto.randomUUID(),
        direction: 'inbound',
        status: 'completed',
        fromNumber: '+254722000001',
        toNumber: '1002',
        externalE164: '+254722000001',
        contactId: over.contactId === undefined ? contactId : over.contactId,
        userId: over.userId === undefined ? agentB.id : over.userId,
        extension: '1002',
        startedAt: new Date(),
        ...(over.recorded
          ? { recordingStatus: 'stored', recordingKey: `recordings/${id}.wav` }
          : {}),
      },
    });
    return id;
  };

  const callNote = async (callId: string): Promise<string> => {
    const note = await ctx.as(agentB, {
      method: 'POST',
      url: '/api/v1/notes',
      payload: { body: 'Wants a callback on Friday', callId },
    });
    expect(note.statusCode, note.body).toBe(201);
    return note.json<Envelope<{ id: string }>>().data.id;
  };

  const idsAt = async (user: TestUser, url: string): Promise<string[]> => {
    const res = await ctx.as(user, { method: 'GET', url });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<Envelope<{ id: string }[]>>().data.map((r) => r.id);
  };

  /** What the contact page's timeline asks for. */
  const timelineRefs = async (user: TestUser, id: string): Promise<string[]> => {
    const res = await ctx.as(user, { method: 'GET', url: `/api/v1/activity?contactId=${id}` });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<Envelope<{ ref: { id: string } }[]>>().data.map((a) => a.ref.id);
  };

  beforeAll(async () => {
    ctx = await TestContext.create();
  });
  beforeEach(async () => {
    await ctx.reset();
    agentA = await ctx.createUser({ role: 'agent', extension: '1001' });
    agentB = await ctx.createUser({ role: 'agent', extension: '1002' });
    contactId = (
      await ctx.as(agentB, {
        method: 'POST',
        url: '/api/v1/contacts',
        payload: { firstName: 'Customer', phones: [{ number: '0722000001' }] },
      })
    ).json<Envelope<{ id: string }>>().data.id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  for (const sharedDirectory of [true, false]) {
    describe(`with the shared address book ${sharedDirectory ? 'on' : 'off'}`, () => {
      beforeEach(async () => {
        await ctx.app.settings.patch({ sharedDirectory }, null);
        // With it off, agent A can open the contact because they once took a call from it.
        if (!sharedDirectory) await call({ userId: agentA.id });
      });

      it("shows agent A the contact's calls that agent B handled, with the handler", async () => {
        const id = await call();
        expect(await idsAt(agentA, `/api/v1/calls?contactId=${contactId}`)).toContain(id);
        const detail = await ctx.as(agentA, { method: 'GET', url: `/api/v1/calls/${id}` });
        expect(detail.statusCode, detail.body).toBe(200);
        expect(
          detail.json<Envelope<{ user: { id: string }; extension: string }>>().data,
        ).toMatchObject({ user: { id: agentB.id }, extension: '1002' });
      });

      it('shows a call answered on a phone with no CRM user, with its extension', async () => {
        const id = await call({ userId: null });
        const list = await ctx.as(agentA, {
          method: 'GET',
          url: `/api/v1/calls?contactId=${contactId}`,
        });
        const row = list
          .json<Envelope<{ id: string; user: unknown; extension: string }[]>>()
          .data.find((c) => c.id === id);
        expect(row).toMatchObject({ user: null, extension: '1002' });
      });

      it("shows agent A the call's timeline entry", async () => {
        const id = await call();
        await ctx.app.db.activity.create({
          data: {
            id: crypto.randomUUID(),
            type: 'call',
            contactId,
            actorId: agentB.id,
            occurredAt: new Date(),
            summary: 'Inbound call',
            refTable: 'calls',
            refId: id,
            meta: { disposition: 'Interested', dispositionNote: 'Send the quote' },
          },
        });
        expect(await timelineRefs(agentA, contactId)).toContain(id);
      });

      it('shows agent A a note agent B wrote on a call of that contact, everywhere', async () => {
        const id = await call();
        const noteId = await callNote(id);
        expect(await idsAt(agentA, `/api/v1/notes?callId=${id}`)).toContain(noteId);
        expect(await idsAt(agentA, `/api/v1/notes?contactId=${contactId}`)).toContain(noteId);
        expect(await timelineRefs(agentA, contactId)).toContain(noteId);
      });

      it('shows agent A a note agent B wrote on the contact itself', async () => {
        const note = await ctx.as(agentB, {
          method: 'POST',
          url: '/api/v1/notes',
          payload: { body: 'Prefers mornings', contactId },
        });
        const noteId = note.json<Envelope<{ id: string }>>().data.id;
        expect(await idsAt(agentA, `/api/v1/notes?contactId=${contactId}`)).toContain(noteId);
      });

      it('keeps a call with no contact, and its notes, with its handler', async () => {
        const id = await call({ contactId: null });
        const noteId = await callNote(id);
        expect(await idsAt(agentA, '/api/v1/calls')).not.toContain(id);
        expect(
          (await ctx.as(agentA, { method: 'GET', url: `/api/v1/calls/${id}` })).statusCode,
        ).toBe(404);
        expect(await idsAt(agentA, `/api/v1/notes?callId=${id}`)).not.toContain(noteId);
        expect(await idsAt(agentB, '/api/v1/calls')).toContain(id);
      });

      it('refuses agent A writing a note on a call of agent B', async () => {
        const id = await call();
        const note = await ctx.as(agentA, {
          method: 'POST',
          url: '/api/v1/notes',
          payload: { body: 'Not my call', callId: id },
        });
        expect(note.statusCode, note.body).toBe(422);
      });

      it('does not let agent A edit or delete the note agent B wrote', async () => {
        const noteId = await callNote(await call());
        const edit = await ctx.as(agentA, {
          method: 'PATCH',
          url: `/api/v1/notes/${noteId}`,
          payload: { body: 'Changed' },
        });
        expect(edit.statusCode, edit.body).toBe(403);
        const del = await ctx.as(agentA, { method: 'DELETE', url: `/api/v1/notes/${noteId}` });
        expect(del.statusCode, del.body).toBe(403);
      });
    });
  }

  it('refuses agent A changing a disposition on a call of agent B', async () => {
    const id = await call();
    const res = await ctx.as(agentA, {
      method: 'PATCH',
      url: `/api/v1/calls/${id}/disposition`,
      payload: { dispositionId: null, note: 'Not my call' },
    });
    expect(res.statusCode, res.body).toBe(404);
    const row = await ctx.app.db.call.findUniqueOrThrow({ where: { id } });
    expect(row.dispositionNote).toBeNull();
  });

  it("keeps agent B's calls out of agent A's own Calls list", async () => {
    const theirs = await call();
    const mine = await call({ userId: agentA.id });
    const all = await idsAt(agentA, '/api/v1/calls');
    expect(all).toContain(mine);
    expect(all).not.toContain(theirs);
    const own = await idsAt(agentA, '/api/v1/calls?mine=true');
    expect(own).toEqual([mine]);
    // Even asking for one contact, "mine" still means mine.
    expect(await idsAt(agentA, `/api/v1/calls?contactId=${contactId}&mine=true`)).toEqual([mine]);
    // By number is a list of the caller's own work too, not a way around it.
    expect(await idsAt(agentA, '/api/v1/calls?number=722000001')).not.toContain(theirs);
  });

  it('keeps the contact-wide feed from becoming every contact activity', async () => {
    const id = await call();
    await ctx.app.db.activity.create({
      data: {
        id: crypto.randomUUID(),
        type: 'call',
        contactId,
        actorId: agentB.id,
        occurredAt: new Date(),
        summary: 'Inbound call',
        refTable: 'calls',
        refId: id,
      },
    });
    const res = await ctx.as(agentA, { method: 'GET', url: '/api/v1/activity' });
    const refs = res.json<Envelope<{ ref: { id: string } }[]>>().data.map((a) => a.ref.id);
    expect(refs).not.toContain(id);
  });

  it('hides the journal of a contact agent A cannot open', async () => {
    await ctx.app.settings.patch({ sharedDirectory: false }, null);
    const id = await call();
    const noteId = await callNote(id);
    expect(await idsAt(agentA, `/api/v1/calls?contactId=${contactId}`)).not.toContain(id);
    expect((await ctx.as(agentA, { method: 'GET', url: `/api/v1/calls/${id}` })).statusCode).toBe(
      404,
    );
    expect(await idsAt(agentA, `/api/v1/notes?callId=${id}`)).not.toContain(noteId);
    expect(await idsAt(agentA, `/api/v1/notes?contactId=${contactId}`)).not.toContain(noteId);
    expect(await timelineRefs(agentA, contactId)).not.toContain(noteId);
  });

  it('leaves recording playback to its own rule, and audits only real plays', async () => {
    const id = await call({ recorded: true });
    const plays = () =>
      ctx.app.db.auditLog.count({ where: { action: 'recording.accessed', entityId: id } });

    // Readable is not playable: agent A can open the call and still cannot hear it.
    expect((await ctx.as(agentA, { method: 'GET', url: `/api/v1/calls/${id}` })).statusCode).toBe(
      200,
    );
    const refused = await ctx.as(agentA, { method: 'GET', url: `/api/v1/calls/${id}/recording` });
    expect(refused.statusCode, refused.body).toBe(404);
    const history = await ctx.as(agentA, {
      method: 'GET',
      url: `/api/v1/calls/${id}/recording-history`,
    });
    expect(history.statusCode, history.body).toBe(404);
    expect(await plays()).toBe(0);

    // The handler still plays their own, and that play is on the record.
    await ctx.as(agentB, { method: 'GET', url: `/api/v1/calls/${id}/recording` });
    expect(await plays()).toBe(1);

    // And the setting still stops them.
    const recording = await ctx.app.settings.get('recording');
    await ctx.app.settings.patch({ recording: { ...recording, allowAgentPlayback: false } }, null);
    const off = await ctx.as(agentB, { method: 'GET', url: `/api/v1/calls/${id}/recording` });
    expect(off.statusCode, off.body).toBe(403);
    expect(await plays()).toBe(1);
  });
});
