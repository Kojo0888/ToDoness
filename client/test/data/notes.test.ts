/** Notes in the local database (docs/notes/PRD.md section 4.2). */
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { newId } from '@todoness/shared';
import { applyChanges } from '../../src/sync/apply-changes';
import { TodonessDB } from '../../src/data/db';
import { RepoError } from '../../src/data/repo';
import { getNoteById, getNotes } from '../../src/data/queries';
import { expectValidOutbox, fakeNow, T0, testRepo } from '../helpers/db';
import { hlcAt, noteChange } from '../helpers/fetch';
import type { TodonessDB as Db } from '../../src/data/db';

/** The outbox in the order it is sent (by clock). */
const sentOrder = async (db: Db) =>
  (await expectValidOutbox(db)).sort((a, b) => (a.hlc < b.hlc ? -1 : 1));

async function setup() {
  const now = fakeNow();
  const t = testRepo({ now });
  const texts = async () => (await getNotes(t.db)).map((n) => n.text);
  return { ...t, now, texts };
}

describe('notes – repo', () => {
  it('creates a note on top and queues one valid create', async () => {
    const s = await setup();
    const a = await s.repo.createNote('First');
    s.now.advance(10);
    await s.repo.createNote('Second\nline');
    expect(await s.texts()).toEqual(['Second\nline', 'First']);
    expect(a).toMatchObject({ text: 'First', isPublic: false, deletedAt: null, createdAt: T0 });

    const ops = await sentOrder(s.db);
    expect(ops.map((o) => [o.entity, o.type])).toEqual([
      ['note', 'create'],
      ['note', 'create'],
    ]);
    expect(ops[0]!.patch).toEqual({ text: 'First', orderKey: a.orderKey });
  });

  it('refuses a blank new note', async () => {
    const s = await setup();
    await expect(s.repo.createNote('   \n ')).rejects.toBeInstanceOf(RepoError);
    expect(await s.db.notes.count()).toBe(0);
    expect(await s.db.outbox.count()).toBe(0);
  });

  it('updates the text (also to empty) and does nothing when unchanged', async () => {
    const s = await setup();
    const n = await s.repo.createNote('One');
    s.now.advance(5);
    await s.repo.updateNoteText(n.id, 'Two');
    await s.repo.updateNoteText(n.id, 'Two');
    await s.repo.updateNoteText(n.id, '');
    expect((await getNoteById(s.db, n.id))!.text).toBe('');
    const ops = await sentOrder(s.db);
    expect(ops.map((o) => o.patch)).toEqual([
      { text: 'One', orderKey: n.orderKey },
      { text: 'Two' },
      { text: '' },
    ]);
  });

  it('switches public on and off', async () => {
    const s = await setup();
    const n = await s.repo.createNote('Shared');
    await s.repo.setNotePublic(n.id, true);
    await s.repo.setNotePublic(n.id, true); // no change, no operation
    expect((await getNoteById(s.db, n.id))!.isPublic).toBe(true);
    await s.repo.setNotePublic(n.id, false);
    const ops = await sentOrder(s.db);
    expect(ops.slice(1).map((o) => o.patch)).toEqual([{ isPublic: true }, { isPublic: false }]);
  });

  it('deletes and restores (both idempotent); deleted notes are not listed', async () => {
    const s = await setup();
    const n = await s.repo.createNote('Gone soon');
    await s.repo.deleteNote(n.id);
    await s.repo.deleteNote(n.id);
    expect(await getNotes(s.db)).toEqual([]);
    expect(await getNoteById(s.db, n.id)).toBeUndefined();
    await s.repo.restoreNote(n.id);
    await s.repo.restoreNote(n.id);
    expect(await s.texts()).toEqual(['Gone soon']);
    const ops = await sentOrder(s.db);
    expect(ops.map((o) => o.type)).toEqual(['create', 'delete', 'restore']);
  });

  it('cannot edit a deleted or unknown note', async () => {
    const s = await setup();
    const n = await s.repo.createNote('x');
    await s.repo.deleteNote(n.id);
    await expect(s.repo.updateNoteText(n.id, 'y')).rejects.toMatchObject({ code: 'not_found' });
    await expect(s.repo.setNotePublic(newId(), true)).rejects.toMatchObject({ code: 'not_found' });
    await expect(s.repo.deleteNote(newId())).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses text over the limit', async () => {
    const s = await setup();
    const n = await s.repo.createNote('x');
    await expect(s.repo.updateNoteText(n.id, 'y'.repeat(20_001))).rejects.toMatchObject({
      code: 'invalid',
    });
  });
});

describe('notes – pulled changes', () => {
  it('applies a note from the server and merges it with a newer local edit', async () => {
    const s = await setup();
    const change = noteChange({ hlc: hlcAt(T0 - 100) });
    await applyChanges(s.db, [change as never], 1, s.now);
    expect(await s.texts()).toEqual(['From server']);

    // A newer local edit stays; an older remote edit gives way.
    await s.repo.updateNoteText(change.entityId, 'Local');
    await applyChanges(
      s.db,
      [
        noteChange({
          entityId: change.entityId,
          type: 'update',
          patch: { text: 'Old remote', isPublic: true },
          hlc: hlcAt(T0 - 50),
        }) as never,
      ],
      2,
      s.now,
    );
    expect(await getNoteById(s.db, change.entityId)).toMatchObject({
      text: 'Local',
      isPublic: true,
    });
  });
});

describe('local database version 3', () => {
  it('upgrades a version-2 database, keeping the data and adding notes', async () => {
    const name = `upgrade3-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const old = new Dexie(name);
    old.version(2).stores({
      lists: 'id, orderKey',
      todos: 'id, listId, [listId+orderKey]',
      outbox: 'opId, hlc, entityId',
      deadLetter: 'opId, failedAt',
      meta: 'key',
      notified: 'key',
    });
    await old.table('lists').put({ id: 'l1', name: 'Inbox', isInbox: true, isPublic: false });
    await old.table('meta').put({ key: 'lastServerSeq', value: 7 });
    old.close();

    const db = new TodonessDB(name);
    expect(await db.lists.get('l1')).toMatchObject({ name: 'Inbox' });
    expect(await db.getMeta('lastServerSeq')).toBe(7);
    expect(await db.notes.count()).toBe(0);
    db.close();
  });

  it('clearAll also removes notes', async () => {
    const s = await setup();
    await s.repo.createNote('x');
    await s.db.clearAll();
    expect(await s.db.notes.count()).toBe(0);
  });
});

describe('notes – sync engine', () => {
  it('sends notes written offline once the server answers, then pulls notes from others', async () => {
    const { createSyncEngine } = await import('../../src/sync/engine');
    const { fakeFetch, json, pullBody } = await import('../helpers/fetch');
    const s = await setup();
    const n = await s.repo.createNote('Offline note');
    await s.repo.updateNoteText(n.id, 'Offline note, edited');

    let online = false;
    const remote = noteChange({ hlc: hlcAt(T0 - 10) });
    const f = fakeFetch((call) => {
      if (!online) return 'network-error';
      if (call.url === '/api/sync/push') {
        return json(200, {
          accepted: call.body.ops.map((o: { opId: string }) => o.opId),
          rejected: [],
        });
      }
      return json(200, pullBody([remote]));
    });
    const engine = createSyncEngine({ db: s.db, fetch: f, now: s.now });
    expect((await engine.sync()).ok).toBe(false);
    expect(await s.db.outbox.count()).toBe(2);

    online = true;
    expect((await engine.sync()).ok).toBe(true);
    const pushed = f.calls.filter((c) => c.url === '/api/sync/push').at(-1)!;
    expect(
      pushed.body.ops.map((o: { entity: string; type: string }) => [o.entity, o.type]),
    ).toEqual([
      ['note', 'create'],
      ['note', 'update'],
    ]);
    expect(await s.db.outbox.count()).toBe(0);
    expect((await s.texts()).sort()).toEqual(['From server', 'Offline note, edited']);
  });
});
