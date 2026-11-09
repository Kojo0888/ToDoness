/** Reading and editing other users' public notes (docs/notes/PRD.md FR-95 – FR-97). */
import { describe, expect, it, vi } from 'vitest';
import { syncOpSchema } from '@todoness/shared';
import { createPublicNotes } from '../../src/services/publicNotes';
import { fakeNow, testDb } from '../helpers/db';
import { fakeFetch, json, type Call } from '../helpers/fetch';

const NOTE = '0192f0c1-0000-7000-8000-0000000000d1';

function setup(
  answer: (call: Call) => Response | 'network-error' = (call) =>
    json(200, { accepted: [call.body.ops[0].opId], rejected: [] }),
) {
  const db = testDb();
  const f = fakeFetch(answer);
  const notes = createPublicNotes({ db, fetch: f, now: fakeNow() });
  return { db, f, notes };
}

describe('public notes – list', () => {
  it('reads the notes of other users', async () => {
    const body = {
      notes: [{ id: NOTE, text: 'Hi', ownerEmail: 'ann@corp.test', updatedAt: 5 }],
    };
    const { notes, f } = setup(() => json(200, body));
    expect(await notes.list()).toEqual(body.notes);
    expect(f.calls[0]).toMatchObject({ method: 'GET', url: '/api/public/notes' });
  });

  it('gives undefined offline, on an error, and on a garbled answer', async () => {
    expect(await setup(() => 'network-error').notes.list()).toBeUndefined();
    expect(await setup(() => json(500, {})).notes.list()).toBeUndefined();
    expect(await setup(() => json(200, { notes: [{ id: 1 }] })).notes.list()).toBeUndefined();
  });
});

describe('public notes – saveText', () => {
  it('sends one valid text update to the note push and tells listeners', async () => {
    const { notes, f, db } = setup();
    await db.setMeta('clientId', 'abcd');
    const heard = vi.fn();
    notes.subscribe(heard);
    expect(await notes.saveText(NOTE, 'New text')).toEqual({ ok: true });
    expect(f.calls[0]).toMatchObject({ method: 'POST', url: `/api/public/notes/${NOTE}/push` });
    expect(f.calls[0]!.body.clientId).toBe('abcd');
    const op = syncOpSchema.parse(f.calls[0]!.body.ops[0]);
    expect(op).toMatchObject({
      entity: 'note',
      type: 'update',
      entityId: NOTE,
      patch: { text: 'New text' },
    });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('maps failures', async () => {
    const run = (answer: (call: Call) => Response | 'network-error') =>
      setup(answer).notes.saveText(NOTE, 'x');
    expect(await run(() => 'network-error')).toEqual({ ok: false, error: 'offline' });
    expect(await run(() => json(404, {}))).toEqual({ ok: false, error: 'gone' });
    expect(await run(() => json(401, {}))).toEqual({ ok: false, error: 'auth' });
    expect(await run(() => json(500, {}))).toEqual({ ok: false, error: 'server' });
    expect(
      await run((c) =>
        json(200, { accepted: [], rejected: [{ opId: c.body.ops[0].opId, reason: 'forbidden' }] }),
      ),
    ).toEqual({ ok: false, error: 'rejected' });
  });

  it('refuses too long text without sending', async () => {
    const { notes, f } = setup();
    expect(await notes.saveText(NOTE, 'x'.repeat(20_001))).toEqual({ ok: false, error: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });
});
