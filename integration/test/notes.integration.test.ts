/** Notes between simulated browsers and the real server (docs/notes/PRD.md). */
import { describe, expect, it } from 'vitest';
import { RECOVERY_KEY, takeSnapshot } from '../../client/src/data/recovery';
import { getNoteLists, getNotes, getNotesOfList } from '../../client/src/data/queries';
import type { PublicListResponse } from '@todoness/shared';
import { overlayListPage } from '../../client/src/data/publicOverlay';
import { createPublicData } from '../../client/src/services/publicData';
import { createPublicEditor } from '../../client/src/services/publicEdit';
import { createPublicNotes } from '../../client/src/services/publicNotes';
import { createRecovery } from '../../client/src/services/recovery';
import { Browser, startServer, twoBrowsers } from './harness';

const texts = async (b: Browser) => (await getNotes(b.db)).map((n) => n.text);
const notesOf = (b: Browser) =>
  b.db.notes.toArray().then((r) => r.sort((x, y) => x.id.localeCompare(y.id)));

describe('notes sync', () => {
  it('notes written offline on one device reach the other after reconnecting', async () => {
    const { a, b } = await twoBrowsers();
    a.online = false;
    const first = await a.repo.createNote('Written offline');
    a.time += 10;
    await a.repo.createNote('Newer');
    await a.repo.setNotePublic(first.id, true);
    expect((await a.sync()).ok).toBe(false);

    a.online = true;
    expect(await a.sync()).toEqual({ ok: true });
    expect(await b.sync()).toEqual({ ok: true });
    expect(await texts(b)).toEqual(['Newer', 'Written offline']);
    expect(await notesOf(b)).toEqual(await notesOf(a));
  });

  it('edits of different fields made offline on two devices are merged', async () => {
    const { a, b } = await twoBrowsers();
    const note = await a.repo.createNote('Draft');
    await a.sync();
    await b.sync();

    a.online = false;
    b.online = false;
    a.time += 1000;
    b.time += 2000;
    await a.repo.setNotePublic(note.id, true);
    await b.repo.updateNoteText(note.id, 'Final text');
    a.online = true;
    b.online = true;
    await a.sync();
    await b.sync();
    await a.sync();

    for (const x of [a, b]) {
      expect(await x.db.notes.get(note.id)).toMatchObject({ text: 'Final text', isPublic: true });
    }
  });

  it('the later text edit wins on both devices; a delete reaches the other device', async () => {
    const { a, b } = await twoBrowsers();
    const note = await a.repo.createNote('Start');
    await a.sync();
    await b.sync();
    a.time += 1000;
    b.time += 5000;
    await a.repo.updateNoteText(note.id, 'From laptop');
    await b.repo.updateNoteText(note.id, 'From phone, later');
    await a.sync();
    await b.sync();
    await a.sync();
    expect(await texts(a)).toEqual(['From phone, later']);
    expect(await texts(b)).toEqual(['From phone, later']);

    await b.repo.deleteNote(note.id);
    await b.sync();
    await a.sync();
    expect(await texts(a)).toEqual([]);
  });
});

describe('public notes', () => {
  /** Bob's view of the public notes: the copy from the server. */
  async function bobSees(bob: Browser) {
    const data = createPublicData({ db: bob.db, fetch: bob.fetch, now: () => bob.time });
    expect(await data.refreshNotes()).toBe(true);
    return (await bob.db.publicCache.get('notes'))!.value as { id: string; text: string }[];
  }

  it("another user's edit, made offline, lands on all of the owner's devices", async () => {
    const server = startServer();
    const { a, b } = await twoBrowsers(server, 'ann@corp.test');
    const bob = new Browser(server, 'bob');
    await bob.register('bob@corp.test');

    const note = await a.repo.createNote('Shared plan');
    await a.repo.setNotePublic(note.id, true);
    await a.sync();
    expect(await bobSees(bob)).toEqual([
      {
        id: note.id,
        text: 'Shared plan',
        ownerEmail: 'ann@corp.test',
        updatedAt: expect.any(Number),
      },
    ]);

    bob.online = false;
    bob.time += 10_000;
    const shared = createPublicNotes({ db: bob.db, now: () => bob.time });
    expect(await shared.saveText(note.id, 'Shared plan, edited by Bob')).toEqual({ ok: true });
    expect((await bob.sync()).ok).toBe(false);
    expect(await bob.db.publicOutbox.count()).toBe(1);

    bob.online = true;
    expect(await bob.sync()).toEqual({ ok: true });
    expect(await bob.db.publicOutbox.count()).toBe(0);
    await a.sync();
    await b.sync();
    expect(await texts(a)).toEqual(['Shared plan, edited by Bob']);
    expect(await texts(b)).toEqual(['Shared plan, edited by Bob']);
    expect(await texts(bob)).toEqual([]); // Bob's own notes are untouched

    // Private again: Bob no longer sees it, and a queued edit is refused, not lost silently.
    await a.repo.setNotePublic(note.id, false);
    await a.sync();
    expect(await bobSees(bob)).toEqual([]);
    await shared.saveText(note.id, 'too late');
    expect(await bob.sync()).toEqual({ ok: true });
    expect((await bob.db.deadLetter.toArray()).map((d) => [d.targetId, d.reason])).toEqual([
      [note.id, 'gone'],
    ]);
    expect(await texts(a)).toEqual(['Shared plan, edited by Bob']);
  });

  it("an owner's newer offline edit beats an older edit of someone else", async () => {
    const server = startServer();
    const { a } = await twoBrowsers(server, 'ann@corp.test');
    const bob = new Browser(server, 'bob');
    await bob.register('bob@corp.test');
    const note = await a.repo.createNote('v1');
    await a.repo.setNotePublic(note.id, true);
    await a.sync();

    a.online = false;
    a.time += 60_000; // Ann edits later, but offline
    await a.repo.updateNoteText(note.id, 'Ann, later');
    bob.time += 1_000;
    await createPublicNotes({ db: bob.db, now: () => bob.time }).saveText(note.id, 'Bob, earlier');
    await bob.sync();

    a.online = true;
    await a.sync();
    expect(await texts(a)).toEqual(['Ann, later']);
    expect((await bobSees(bob))[0]!.text).toBe('Ann, later');
  });
});

describe('public lists edited offline', () => {
  async function setup() {
    const server = startServer();
    const { a, b } = await twoBrowsers(server, 'ann@corp.test');
    const bob = new Browser(server, 'bob');
    await bob.register('bob@corp.test');
    const list = await a.repo.createList('Recipes');
    await a.repo.setListPublic(list.id, true);
    const soup = await a.repo.createTodo({ listId: list.id, title: 'Soup' });
    await a.sync();
    const data = createPublicData({ db: bob.db, fetch: bob.fetch, now: () => bob.time });
    const editor = createPublicEditor({ db: bob.db, now: () => bob.time });
    return { server, a, b, bob, list, soup, data, editor };
  }

  it('Bob reads the kept copy offline, edits, and Ann gets everything after he reconnects', async () => {
    const { a, b, bob, list, soup, data, editor } = await setup();
    expect(await data.refreshList(list.id)).toBe(true);

    bob.online = false;
    expect(await data.refreshList(list.id)).toBe(false); // the copy stays
    const copy = (await bob.db.publicCache.get(`list:${list.id}`))!.value as PublicListResponse;
    expect(copy.todos.map((x) => x.title)).toEqual(['Soup']);

    bob.time += 5_000;
    await editor.createTodo(list.id, 'Bread', copy.todos[0]!.orderKey);
    await editor.setDone(list.id, soup.id, true);
    await editor.updateTodo(list.id, soup.id, { title: 'Soup, edited' });
    const queued = await bob.db.publicOutbox.toArray();
    expect(overlayListPage(copy, queued).todos.map((x) => [x.title, x.done])).toEqual([
      ['Bread', false],
      ['Soup, edited', true],
    ]);

    bob.online = true;
    expect(await bob.sync()).toEqual({ ok: true });
    await a.sync();
    await b.sync();
    for (const x of [a, b]) {
      expect(await x.titles(list.id)).toEqual(['Bread']);
      const done = await x.db.todos.get(soup.id);
      expect(done).toMatchObject({ title: 'Soup, edited', done: true });
    }
    await data.refreshList(list.id);
    const after = (await bob.db.publicCache.get(`list:${list.id}`))!.value as PublicListResponse;
    expect(after.todos.map((x) => x.title).sort()).toEqual(['Bread', 'Soup, edited']);
  });

  it('a list made private while Bob was offline refuses his changes', async () => {
    const { a, bob, list, soup, editor } = await setup();
    bob.online = false;
    await editor.updateTodo(list.id, soup.id, { title: 'Bob was here' });
    await a.repo.setListPublic(list.id, false);
    await a.sync();

    bob.online = true;
    expect(await bob.sync()).toEqual({ ok: true });
    expect((await bob.db.deadLetter.toArray()).map((d) => [d.target, d.reason])).toEqual([
      ['list', 'gone'],
    ]);
    await a.sync();
    expect((await a.db.todos.get(soup.id))!.title).toBe('Soup');
  });
});

describe('recovery with notes', () => {
  async function lostServer(prepare: (a: Browser) => Promise<void>) {
    const old = startServer();
    const a = new Browser(old, 'laptop');
    await a.register('ann@corp.test');
    await prepare(a);
    expect(await a.sync()).toEqual({ ok: true });

    const fresh = startServer();
    const snapshot = await takeSnapshot(a.db, 'ann@corp.test', () => a.time);
    await a.db.clearAll(snapshot ? [{ key: RECOVERY_KEY, value: snapshot }] : []);
    a.switchServer(fresh);
    return { a, fresh };
  }

  it('a device holding only notes gets them back on the server (append)', async () => {
    const { a, fresh } = await lostServer(async (a) => {
      await a.repo.createNote('Only notes here');
    });
    await a.register('ann@corp.test');
    const recovery = createRecovery({ db: a.db, repo: a.repo });
    await recovery.load();
    expect(recovery.getOffer()).toMatchObject({ notes: 1, todos: 0, lists: 0 });
    expect(await recovery.accept('append')).toMatchObject({ ok: true, notes: 1 });
    expect(await a.sync()).toEqual({ ok: true });

    const phone = new Browser(fresh, 'phone');
    await phone.login('ann@corp.test');
    await phone.sync();
    expect(await texts(phone)).toEqual(['Only notes here']);
  });

  it('overwrite removes the notes another device already put in the new account', async () => {
    const { a, fresh } = await lostServer(async (a) => {
      await a.repo.createNote('Old note');
    });
    const phone = new Browser(fresh, 'phone');
    await phone.register('ann@corp.test');
    await phone.repo.createNote('Phone note');
    await phone.sync();

    await a.login('ann@corp.test');
    await a.sync();
    const recovery = createRecovery({ db: a.db, repo: a.repo });
    await recovery.load();
    expect(recovery.getOffer()).toMatchObject({ notes: 1, accountNotes: 1 });
    await recovery.accept('overwrite');
    await a.sync();
    await phone.sync();
    expect(await texts(phone)).toEqual(['Old note']);
  });
});

describe('note lists sync (docs/recovery-upload FR-167)', () => {
  const names = async (b: Browser) => (await getNoteLists(b.db)).map((l) => l.name);
  const inList = async (b: Browser, listId: string | null) =>
    (await getNotesOfList(b.db, listId)).map((n) => n.text);

  it('a note list with notes, made offline, reaches the other device', async () => {
    const { a, b } = await twoBrowsers();
    a.online = false;
    const ideas = await a.repo.createList('Ideas', 'notes');
    await a.repo.createNote('Garden', ideas.id);
    a.time += 10;
    await a.repo.createNote('Kitchen', ideas.id);
    await a.repo.createNote('Loose note');
    a.online = true;
    expect(await a.sync()).toEqual({ ok: true });
    expect(await b.sync()).toEqual({ ok: true });

    expect(await names(b)).toEqual(await names(a));
    expect(await names(b)).toContain('Ideas');
    expect(await inList(b, ideas.id)).toEqual(['Kitchen', 'Garden']);
    expect(await inList(b, null)).toEqual(['Loose note']);
    expect((await b.db.lists.get(ideas.id))?.module).toBe('notes');
    expect(await notesOf(b)).toEqual(await notesOf(a));
  });

  it('a renamed note list is renamed on the other device', async () => {
    const { a, b } = await twoBrowsers();
    const ideas = await a.repo.createList('Ideas', 'notes');
    await a.sync();
    await b.sync();
    await b.repo.renameList(ideas.id, 'Projects');
    await b.sync();
    await a.sync();
    expect((await a.db.lists.get(ideas.id))?.name).toBe('Projects');
  });

  it('deleting a note list on one device removes it and its notes on the other', async () => {
    const { a, b } = await twoBrowsers();
    const ideas = await a.repo.createList('Ideas', 'notes');
    const note = await a.repo.createNote('Inside', ideas.id);
    const kept = await a.repo.createNote('Outside');
    await a.sync();
    await b.sync();
    await b.repo.deleteList(ideas.id);
    await b.sync();
    await a.sync();
    expect(await names(a)).not.toContain('Ideas');
    expect((await a.db.notes.get(note.id))?.deletedAt).not.toBeNull();
    expect((await a.db.notes.get(kept.id))?.deletedAt).toBeNull();
  });

  it('a note reordered and one restored after a delete follow on the other device', async () => {
    const { a, b } = await twoBrowsers();
    const one = await a.repo.createNote('one');
    a.time += 10;
    const two = await a.repo.createNote('two');
    await a.sync();
    await b.sync();
    expect(await texts(b)).toEqual(['two', 'one']);

    await a.repo.reorderNote(one.id, two.id);
    await a.repo.deleteNote(two.id);
    await a.sync();
    await b.sync();
    expect(await texts(b)).toEqual(['one']);

    await b.repo.restoreNote(two.id);
    await b.sync();
    await a.sync();
    expect(await texts(a)).toEqual(['one', 'two']);
    expect(await notesOf(a)).toEqual(await notesOf(b));
  });
});
