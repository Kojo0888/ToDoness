/** Note lists in the local database (docs/note-lists/PRD.md FR-124 – FR-132). */
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import {
  countNotesByList,
  countOpenTodosByList,
  getLists,
  getNoteLists,
  getNotesOfList,
} from '../../src/data/queries';
import { TodonessDB } from '../../src/data/db';
import { takeSnapshot } from '../../src/data/recovery';
import { expectValidOutbox, fakeNow, seedInbox, seedNotesList, testRepo } from '../helpers/db';

async function setup() {
  const now = fakeNow();
  const t = testRepo({ now });
  const inbox = await seedInbox(t.db);
  const myNotes = await seedNotesList(t.db);
  return { ...t, now, inbox, myNotes };
}

describe('note lists – repo and queries', () => {
  it('keeps note lists apart from task lists', async () => {
    const s = await setup();
    await s.repo.createList('Work');
    const ideas = await s.repo.createList('Ideas', 'notes');
    expect((await getLists(s.db)).map((l) => l.name)).toEqual(['Inbox', 'Work']);
    expect((await getNoteLists(s.db)).map((l) => l.name)).toEqual(['My notes', 'Ideas']);
    const ops = await expectValidOutbox(s.db);
    expect(ops.find((o) => o.entityId === ideas.id)!.patch).toMatchObject({ module: 'notes' });
    // A task list is created as before, without the field.
    expect(ops.find((o) => o.entityId !== ideas.id)!.patch).not.toHaveProperty('module');
  });

  it('adds a note to a list; My notes holds the notes without a list', async () => {
    const s = await setup();
    const ideas = await s.repo.createList('Ideas', 'notes');
    await s.repo.createNote('Mine');
    s.now.advance(1);
    await s.repo.createNote('Idea', ideas.id);
    expect((await getNotesOfList(s.db, null)).map((n) => n.text)).toEqual(['Mine']);
    expect((await getNotesOfList(s.db, ideas.id)).map((n) => n.text)).toEqual(['Idea']);
    expect(await countNotesByList(s.db)).toEqual(
      new Map([
        [null, 1],
        [ideas.id, 1],
      ]),
    );
    await expectValidOutbox(s.db);
  });

  it('refuses a note in a task list', async () => {
    const s = await setup();
    await expect(s.repo.createNote('x', s.inbox.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('may rename My notes, but not delete or move it (FR-129)', async () => {
    const s = await setup();
    await s.repo.renameList(s.myNotes.id, 'Personal');
    expect((await getNoteLists(s.db))[0]!.name).toBe('Personal');
    await expect(s.repo.deleteList(s.myNotes.id)).rejects.toMatchObject({
      code: 'inbox_protected',
    });
    const ideas = await s.repo.createList('Ideas', 'notes');
    await expect(s.repo.reorderList(ideas.id, s.myNotes.id)).rejects.toMatchObject({
      code: 'inbox_protected',
    });
  });

  it('still keeps the name of the task Inbox', async () => {
    const s = await setup();
    await expect(s.repo.renameList(s.inbox.id, 'X')).rejects.toMatchObject({
      code: 'inbox_protected',
    });
  });

  it('reorders note lists among themselves (FR-128)', async () => {
    const s = await setup();
    await s.repo.createList('Work');
    const a = await s.repo.createList('A', 'notes');
    const b = await s.repo.createList('B', 'notes');
    await s.repo.reorderList(b.id, a.id);
    expect((await getNoteLists(s.db)).map((l) => l.name)).toEqual(['My notes', 'B', 'A']);
    expect((await getLists(s.db)).map((l) => l.name)).toEqual(['Inbox', 'Work']);
  });

  it('deleting a note list deletes its notes (FR-128)', async () => {
    const s = await setup();
    const ideas = await s.repo.createList('Ideas', 'notes');
    await s.repo.createNote('Idea', ideas.id);
    await s.repo.createNote('Mine');
    await s.repo.deleteList(ideas.id);
    expect(await getNoteLists(s.db)).toHaveLength(1);
    expect((await getNotesOfList(s.db, null)).map((n) => n.text)).toEqual(['Mine']);
    expect(await countNotesByList(s.db)).toEqual(new Map([[null, 1]]));
  });

  it('reorders notes within their own list', async () => {
    const s = await setup();
    const ideas = await s.repo.createList('Ideas', 'notes');
    const a = await s.repo.createNote('A', ideas.id);
    s.now.advance(1);
    const b = await s.repo.createNote('B', ideas.id);
    await s.repo.createNote('Mine');
    await s.repo.reorderNote(b.id, null);
    expect((await getNotesOfList(s.db, ideas.id)).map((n) => n.text)).toEqual(['A', 'B']);
    void a;
  });

  it('counts the open tasks of each list (FR-132)', async () => {
    const s = await setup();
    await s.repo.createTodo({ listId: s.inbox.id, title: 'a' });
    const done = await s.repo.createTodo({ listId: s.inbox.id, title: 'b' });
    await s.repo.setDone(done.id, true);
    const gone = await s.repo.createTodo({ listId: s.inbox.id, title: 'c' });
    await s.repo.deleteTodo(gone.id);
    expect(await countOpenTodosByList(s.db)).toEqual(new Map([[s.inbox.id, 1]]));
  });
});

describe('local database upgrade to version 6', () => {
  it('marks stored lists as task lists and notes as in My notes', async () => {
    const name = `upgrade6-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const old = new Dexie(name);
    old.version(5).stores({
      lists: 'id, orderKey',
      todos: 'id, listId, [listId+orderKey]',
      notes: 'id, orderKey',
      outbox: 'opId, hlc, entityId',
      deadLetter: 'opId, failedAt',
      meta: 'key',
      notified: 'key',
      publicOutbox: 'opId, hlc, targetId',
      publicCache: 'key',
    });
    await old.table('lists').put({ id: 'l', name: 'L', orderKey: 'a0', deletedAt: null });
    await old.table('notes').put({ id: 'n', text: 'x', orderKey: 'a0', deletedAt: null });
    old.close();
    const db = new TodonessDB(name);
    expect((await db.lists.get('l'))?.module).toBe('tasks');
    expect((await db.notes.get('n'))?.listId).toBe(null);
    db.close();
  });
});

describe('note lists in the recovery (FR-131)', () => {
  it('restores note lists with their notes; notes of the old My notes go to My notes', async () => {
    const old = await setup();
    const ideas = await old.repo.createList('Ideas', 'notes');
    await old.repo.createNote('Idea', ideas.id);
    await old.repo.createNote('Mine');
    const snap = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    expect(snap.lists.map((l) => l.name)).toEqual(['Ideas']); // not the default lists

    const fresh = await setup();
    await fresh.repo.restoreSnapshot(snap, 'append');
    expect((await getNoteLists(fresh.db)).map((l) => l.name)).toEqual(['My notes', 'Ideas']);
    expect((await getNotesOfList(fresh.db, ideas.id)).map((n) => n.text)).toEqual(['Idea']);
    expect((await getNotesOfList(fresh.db, null)).map((n) => n.text)).toEqual(['Mine']);
    expect((await getLists(fresh.db)).map((l) => l.name)).toEqual(['Inbox']);
    await expectValidOutbox(fresh.db);
  });
});
