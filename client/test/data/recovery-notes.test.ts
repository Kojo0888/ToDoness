/** Notes in the recovery after a server loss (docs/notes/PRD.md FR-98, FR-99). */
import { describe, expect, it } from 'vitest';
import { newId } from '@todoness/shared';
import { RECOVERY_KEY, takeSnapshot, type RecoverySnapshot } from '../../src/data/recovery';
import { createRepo } from '../../src/data/repo';
import { getNotes } from '../../src/data/queries';
import { createRecovery } from '../../src/services/recovery';
import { expectValidOutbox, fakeNow, seedInbox, testDb, T0 } from '../helpers/db';

async function oldDevice(opts: { tasks?: boolean } = {}) {
  const db = testDb();
  const now = fakeNow();
  const repo = createRepo(db, { now });
  const inbox = await seedInbox(db);
  if (opts.tasks !== false) await repo.createTodo({ listId: inbox.id, title: 'A task' });
  const older = await repo.createNote('Older note');
  now.advance(10);
  const shared = await repo.createNote('Shared note');
  await repo.setNotePublic(shared.id, true);
  const gone = await repo.createNote('Deleted note');
  await repo.deleteNote(gone.id);
  await db.outbox.clear();
  return { db, repo, older, shared, gone };
}

async function freshAccount() {
  const db = testDb();
  const repo = createRepo(db, { now: fakeNow(T0 + 1000) });
  const inbox = await seedInbox(db, newId(T0 + 5_000));
  return { db, repo, inbox };
}

describe('takeSnapshot with notes', () => {
  it('keeps live notes with their fields and skips deleted ones', async () => {
    const old = await oldDevice();
    const snap = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    expect(snap.notes.map((n) => n.text).sort()).toEqual(['Older note', 'Shared note']);
    expect(snap.notes.find((n) => n.id === old.shared.id)).toMatchObject({
      isPublic: true,
      orderKey: old.shared.orderKey,
    });
  });

  it('a device with only notes still has something to restore', async () => {
    const old = await oldDevice({ tasks: false });
    const snap = await takeSnapshot(old.db, 'ann@corp.test');
    expect(snap).toBeDefined();
    expect(snap!.todos).toEqual([]);
    expect(snap!.notes).toHaveLength(2);
  });
});

describe('restoreSnapshot with notes', () => {
  it('append: brings the notes back with ids, text, public flag and order', async () => {
    const old = await oldDevice();
    const snap = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    const fresh = await freshAccount();
    const mine = await fresh.repo.createNote('Already here');
    const counts = await fresh.repo.restoreSnapshot(snap, 'append');
    expect(counts).toMatchObject({ notes: 2 });

    const notes = await getNotes(fresh.db);
    expect(notes.map((n) => n.id).sort()).toEqual([mine.id, old.older.id, old.shared.id].sort());
    expect(notes.find((n) => n.id === old.shared.id)).toMatchObject({
      text: 'Shared note',
      isPublic: true,
      orderKey: old.shared.orderKey,
    });
    const ops = await expectValidOutbox(fresh.db);
    expect(ops.filter((o) => o.entity === 'note' && o.type === 'create')).toHaveLength(3);
  });

  it("overwrite: deletes the account's notes first", async () => {
    const old = await oldDevice();
    const snap = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    const fresh = await freshAccount();
    await fresh.repo.createNote('Already here');
    await fresh.repo.restoreSnapshot(snap, 'overwrite');
    expect((await getNotes(fresh.db)).map((n) => n.text).sort()).toEqual([
      'Older note',
      'Shared note',
    ]);
  });

  it('restoring twice merges, and a note deleted on the account comes back', async () => {
    const old = await oldDevice();
    const snap = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    const fresh = await freshAccount();
    await fresh.repo.restoreSnapshot(snap, 'append');
    await fresh.repo.deleteNote(old.older.id);
    await fresh.repo.restoreSnapshot(snap, 'append');
    expect(await getNotes(fresh.db)).toHaveLength(2);
  });

  it('a snapshot kept before the notes update (no `notes`) still restores', async () => {
    const old = await oldDevice();
    const { notes, ...legacy } = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    void notes;
    const fresh = await freshAccount();
    const counts = await fresh.repo.restoreSnapshot(legacy as RecoverySnapshot, 'append');
    expect(counts).toEqual({ lists: 0, todos: 1, notes: 0, plans: 0 });
  });
});

describe('recovery offer with notes', () => {
  it('counts the kept notes and the notes the account holds', async () => {
    const old = await oldDevice();
    const snap = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    const fresh = await freshAccount();
    await fresh.repo.createNote('Already here');
    await fresh.db.setMeta(RECOVERY_KEY, snap);
    const recovery = createRecovery({ db: fresh.db, repo: fresh.repo });
    await recovery.load();
    expect(recovery.getOffer()).toMatchObject({ notes: 2, accountNotes: 1, todos: 1 });
  });

  it('an old snapshot without notes offers 0 notes', async () => {
    const old = await oldDevice();
    const { notes, ...legacy } = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    void notes;
    const fresh = await freshAccount();
    await fresh.db.setMeta(RECOVERY_KEY, legacy);
    const recovery = createRecovery({ db: fresh.db, repo: fresh.repo });
    await recovery.load();
    expect(recovery.getOffer()).toMatchObject({ notes: 0, accountNotes: 0 });
  });
});
