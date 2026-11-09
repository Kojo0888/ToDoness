/** The sync engine sends queued public edits (docs/notes/PRD.md FR-108, FR-109). */
import { describe, expect, it } from 'vitest';
import { createRepo } from '../../src/data/repo';
import { createPublicEditor } from '../../src/services/publicEdit';
import { createPublicNotes } from '../../src/services/publicNotes';
import { createSyncEngine } from '../../src/sync/engine';
import { fakeNow, seedInbox, testDb } from '../helpers/db';
import { fakeFetch, json, pullBody, type Call } from '../helpers/fetch';

const LIST = '0192f0c1-0000-7000-8000-0000000000a1';
const LIST2 = '0192f0c1-0000-7000-8000-0000000000a2';
const NOTE = '0192f0c1-0000-7000-8000-0000000000d1';
const TODO = '0192f0c1-0000-7000-8000-0000000000b1';

const acceptAll = (call: Call) =>
  json(200, { accepted: call.body.ops.map((o: { opId: string }) => o.opId), rejected: [] });

async function setup(answer: (call: Call) => Response | 'network-error') {
  const db = testDb();
  const now = fakeNow();
  const f = fakeFetch((call) =>
    call.url.startsWith('/api/sync/pull') ? json(200, pullBody([])) : answer(call),
  );
  const engine = createSyncEngine({ db, fetch: f, now });
  const lists = createPublicEditor({ db, now });
  const notes = createPublicNotes({ db, now });
  const pushes = () => f.calls.filter((c) => c.method === 'POST');
  return { db, now, f, engine, lists, notes, pushes };
}

describe('sending queued public edits', () => {
  it('sends own changes first, then each target to its own endpoint, in clock order', async () => {
    const s = await setup(acceptAll);
    const inbox = await seedInbox(s.db);
    await s.lists.updateTodo(LIST, TODO, { title: 'one' });
    await s.notes.saveText(NOTE, 'note text');
    await createRepo(s.db, { now: s.now }).createTodo({ listId: inbox.id, title: 'mine' });
    await s.lists.updateTodo(LIST2, TODO, { title: 'other list' });
    await s.lists.updateTodo(LIST, TODO, { title: 'two' });

    expect(await s.engine.sync()).toEqual({ ok: true });
    expect(s.pushes().map((c) => [c.url, c.body.ops.length])).toEqual([
      ['/api/sync/push', 1],
      [`/api/public/lists/${LIST}/push`, 2],
      [`/api/public/notes/${NOTE}/push`, 1],
      [`/api/public/lists/${LIST2}/push`, 1],
    ]);
    const listCall = s.pushes()[1]!;
    expect(listCall.body.ops.map((o: { patch: { title: string } }) => o.patch.title)).toEqual([
      'one',
      'two',
    ]);
    // Only the fields the server expects, and the browser id.
    expect(Object.keys(listCall.body.ops[0]).sort()).toEqual(
      ['entity', 'entityId', 'hlc', 'opId', 'patch', 'type'].sort(),
    );
    expect(listCall.body.clientId).toBe(await s.db.getMeta('clientId'));
    expect(await s.db.publicOutbox.count()).toBe(0);
  });

  it('refused operations and gone targets go to the dead letter with their target', async () => {
    const s = await setup((call) => {
      if (call.url.includes(NOTE)) return json(404, { error: 'not_found' });
      const [first, second] = call.body.ops as { opId: string }[];
      return json(200, {
        accepted: [first!.opId],
        rejected: [{ opId: second!.opId, reason: 'forbidden' }],
      });
    });
    await s.lists.updateTodo(LIST, TODO, { title: 'ok' });
    await s.lists.deleteTodo(LIST, TODO);
    await s.notes.saveText(NOTE, 'a');
    await s.notes.saveText(NOTE, 'b');

    expect(await s.engine.sync()).toEqual({ ok: true });
    expect(await s.db.publicOutbox.count()).toBe(0);
    const dead = await s.db.deadLetter.toArray();
    expect(dead.map((d) => [d.targetId, d.reason]).sort()).toEqual(
      [
        [LIST, 'forbidden'],
        [NOTE, 'gone'],
        [NOTE, 'gone'],
      ].sort(),
    );
  });

  it('keeps the queue when offline or on a server error, and reports login problems', async () => {
    let answer: Response | 'network-error' = 'network-error';
    const s = await setup(() => answer);
    await s.notes.saveText(NOTE, 'waiting');

    expect(await s.engine.sync()).toMatchObject({ ok: false, kind: 'offline' });
    expect((await s.db.publicOutbox.toArray())[0]!.attempts).toBe(1);
    answer = json(503, {});
    expect(await s.engine.sync()).toMatchObject({ ok: false, kind: 'server' });
    answer = json(401, {});
    expect(await s.engine.sync()).toMatchObject({ ok: false, kind: 'auth' });
    expect(await s.db.publicOutbox.count()).toBe(1);
    expect(await s.db.deadLetter.count()).toBe(0);
  });

  it('a whole batch the server calls invalid goes to the dead letter', async () => {
    const s = await setup(() => json(400, { error: 'invalid_request' }));
    await s.notes.saveText(NOTE, 'x');
    expect(await s.engine.sync()).toEqual({ ok: true });
    expect((await s.db.deadLetter.toArray()).map((d) => d.reason)).toEqual(['http_400']);
  });
});
