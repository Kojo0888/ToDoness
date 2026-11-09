/** Notes between simulated browsers and the real server (docs/notes/PRD.md). */
import { describe, expect, it } from 'vitest';
import { RECOVERY_KEY, takeSnapshot } from '../../client/src/data/recovery';
import { getNotes } from '../../client/src/data/queries';
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
  it("another user's edit lands on all of the owner's devices", async () => {
    const server = startServer();
    const { a, b } = await twoBrowsers(server, 'ann@corp.test');
    const bob = new Browser(server, 'bob');
    await bob.register('bob@corp.test');

    const note = await a.repo.createNote('Shared plan');
    await a.repo.setNotePublic(note.id, true);
    await a.sync();

    const shared = createPublicNotes({ db: bob.db, fetch: bob.fetch, now: () => bob.time });
    const seen = await shared.list();
    expect(seen).toEqual([
      {
        id: note.id,
        text: 'Shared plan',
        ownerEmail: 'ann@corp.test',
        updatedAt: expect.any(Number),
      },
    ]);
    bob.time += 10_000;
    expect(await shared.saveText(note.id, 'Shared plan, edited by Bob')).toEqual({ ok: true });

    await a.sync();
    await b.sync();
    expect(await texts(a)).toEqual(['Shared plan, edited by Bob']);
    expect(await texts(b)).toEqual(['Shared plan, edited by Bob']);
    // Bob's own notes are untouched.
    await bob.sync();
    expect(await texts(bob)).toEqual([]);

    // Private again: Bob neither sees nor edits it.
    await a.repo.setNotePublic(note.id, false);
    await a.sync();
    expect(await shared.list()).toEqual([]);
    expect(await shared.saveText(note.id, 'too late')).toEqual({ ok: false, error: 'gone' });
  });

  it("an owner's newer offline edit beats an older public edit", async () => {
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
    const shared = createPublicNotes({ db: bob.db, fetch: bob.fetch, now: () => bob.time });
    expect(await shared.saveText(note.id, 'Bob, earlier')).toEqual({ ok: true });

    a.online = true;
    await a.sync();
    expect(await texts(a)).toEqual(['Ann, later']);
    expect((await shared.list())![0]!.text).toBe('Ann, later');
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
