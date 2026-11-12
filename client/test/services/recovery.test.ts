import { describe, expect, it, vi } from 'vitest';
import { newId } from '@todoness/shared';
import { RECOVERY_KEY, takeSnapshot } from '../../src/data/recovery';
import { createRepo } from '../../src/data/repo';
import { createRecovery, isAccountEmpty } from '../../src/services/recovery';
import { fakeNow, seedInbox, testDb, T0 } from '../helpers/db';

/** A device that was Ann's, now showing a fresh account (new Inbox) with the data kept aside. */
async function deviceWithKeptData(opts: { snapshot?: boolean } = {}) {
  const old = testDb();
  const oldRepo = createRepo(old, { now: fakeNow() });
  const oldInbox = await seedInbox(old);
  const work = await oldRepo.createList('Work');
  await oldRepo.createTodo({ listId: oldInbox.id, title: 'one' });
  await oldRepo.createTodo({ listId: work.id, title: 'two' });
  const snapshot = (await takeSnapshot(old, 'ann@corp.test'))!;

  const db = testDb();
  const repo = createRepo(db, { now: fakeNow(T0 + 1000) });
  const inbox = await seedInbox(db, newId(T0 + 5000));
  if (opts.snapshot !== false) await db.setMeta(RECOVERY_KEY, snapshot);
  return { db, repo, inbox, snapshot };
}

describe('recovery service', () => {
  it('has no offer when nothing was kept aside', async () => {
    const { db, repo } = await deviceWithKeptData({ snapshot: false });
    const recovery = createRecovery({ db, repo });
    await recovery.load();
    expect(recovery.getOffer()).toBeUndefined();
  });

  it('offers the kept data, and says the account is empty', async () => {
    const { db, repo } = await deviceWithKeptData();
    const recovery = createRecovery({ db, repo });
    await recovery.load();
    expect(recovery.getOffer()).toEqual({
      fromEmail: 'ann@corp.test',
      todos: 2,
      lists: 1,
      notes: 0,
      plans: 0,
      accountTodos: 0,
      accountLists: 0,
      accountNotes: 0,
      accountPlans: 0,
    });
  });

  it('says how much the account already holds', async () => {
    const { db, repo, inbox } = await deviceWithKeptData();
    await repo.createTodo({ listId: inbox.id, title: 'already here' });
    await repo.createList('Mine');
    const recovery = createRecovery({ db, repo });
    await recovery.load();
    expect(recovery.getOffer()).toMatchObject({ accountTodos: 1, accountLists: 1 });
  });

  it('the offer survives a reload (a new service instance)', async () => {
    const { db, repo } = await deviceWithKeptData();
    await createRecovery({ db, repo }).load();
    const again = createRecovery({ db, repo });
    await again.load();
    expect(again.getOffer()).toBeDefined();
  });

  it('notifies listeners when the offer appears and when it is gone', async () => {
    const { db, repo } = await deviceWithKeptData();
    const recovery = createRecovery({ db, repo });
    let calls = 0;
    recovery.subscribe(() => calls++);
    await recovery.load();
    expect(calls).toBe(1);
    await recovery.decline();
    expect(calls).toBe(2);
  });

  it('a load that was slow does not bring back an offer that was answered meanwhile', async () => {
    const { db, repo } = await deviceWithKeptData();
    const recovery = createRecovery({ db, repo });
    // Hold the load after it has read the snapshot, answer the question, then let it go on.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = db.todos.toArray.bind(db.todos);
    vi.spyOn(db.todos, 'toArray').mockImplementation((async () => {
      await gate;
      return original();
    }) as never);
    const slow = recovery.load();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await recovery.decline();
    release();
    await slow;
    expect(recovery.getOffer()).toBeUndefined();
  });

  it('loading again refreshes what the account holds', async () => {
    const { db, repo, inbox } = await deviceWithKeptData();
    const recovery = createRecovery({ db, repo });
    await recovery.load();
    expect(recovery.getOffer()).toMatchObject({ accountTodos: 0 });
    await repo.createTodo({ listId: inbox.id, title: 'arrived by sync' });
    await recovery.load();
    expect(recovery.getOffer()).toMatchObject({ accountTodos: 1 });
  });

  it('accept (append) queues the data, removes the offer and the kept snapshot', async () => {
    const { db, repo, inbox } = await deviceWithKeptData();
    await repo.createTodo({ listId: inbox.id, title: 'already here' });
    await db.outbox.clear();
    const recovery = createRecovery({ db, repo });
    await recovery.load();

    expect(await recovery.accept('append')).toEqual({
      ok: true,
      lists: 1,
      todos: 2,
      notes: 0,
      plans: 0,
    });
    expect(recovery.getOffer()).toBeUndefined();
    expect(await db.getMeta(RECOVERY_KEY)).toBeUndefined();
    const titles = (await db.todos.toArray()).filter((t) => !t.deletedAt).map((t) => t.title);
    expect(titles.sort()).toEqual(['already here', 'one', 'two']);
    expect(await db.outbox.count()).toBe(1 + 2 + 0 + 0); // 1 list + 2 tasks
  });

  it('accept (overwrite) replaces what the account holds', async () => {
    const { db, repo, inbox } = await deviceWithKeptData();
    await repo.createTodo({ listId: inbox.id, title: 'already here' });
    const recovery = createRecovery({ db, repo });
    await recovery.load();
    expect(await recovery.accept('overwrite')).toMatchObject({ ok: true });
    const titles = (await db.todos.toArray()).filter((t) => !t.deletedAt).map((t) => t.title);
    expect(titles.sort()).toEqual(['one', 'two']);
  });

  it('decline discards the kept data and nothing is queued', async () => {
    const { db, repo } = await deviceWithKeptData();
    await db.outbox.clear();
    const recovery = createRecovery({ db, repo });
    await recovery.load();
    await recovery.decline();
    expect(recovery.getOffer()).toBeUndefined();
    expect(await db.getMeta(RECOVERY_KEY)).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.todos.count()).toBe(0);
  });

  it('accept without the new Inbox fails and keeps the data for later', async () => {
    const { db, repo } = await deviceWithKeptData();
    await db.lists.clear();
    const recovery = createRecovery({ db, repo });
    await recovery.load();
    expect(await recovery.accept('append')).toEqual({ ok: false, error: 'no_inbox' });
    expect(recovery.getOffer()).toBeDefined();
    expect(await db.getMeta(RECOVERY_KEY)).toBeDefined();
  });

  it('accept after the data was answered elsewhere (another tab) clears the stale offer', async () => {
    const { db, repo } = await deviceWithKeptData();
    const recovery = createRecovery({ db, repo });
    await recovery.load();
    expect(recovery.getOffer()).toBeDefined();
    await db.meta.delete(RECOVERY_KEY); // the other tab answered
    expect(await recovery.accept('append')).toEqual({ ok: false, error: 'no_offer' });
    expect(recovery.getOffer()).toBeUndefined(); // so the popup can close
  });

  it('accept without an offer does nothing', async () => {
    const { db, repo } = await deviceWithKeptData({ snapshot: false });
    const recovery = createRecovery({ db, repo });
    await recovery.load();
    expect(await recovery.accept('append')).toEqual({ ok: false, error: 'no_offer' });
  });
});

describe('isAccountEmpty (docs/recovery-upload FR-163, FR-164)', () => {
  const offer = {
    fromEmail: 'ann@corp.test',
    todos: 2,
    lists: 1,
    notes: 1,
    plans: 1,
    accountTodos: 0,
    accountLists: 0,
    accountNotes: 0,
    accountPlans: 0,
  };

  it('is empty when the account holds nothing but its Inbox', () => {
    expect(isAccountEmpty(offer)).toBe(true);
  });

  it.each(['accountTodos', 'accountLists', 'accountNotes', 'accountPlans'] as const)(
    'is not empty with one in %s',
    (key) => {
      expect(isAccountEmpty({ ...offer, [key]: 1 })).toBe(false);
    },
  );

  it('a fresh account with kept data offers an empty account', async () => {
    const { db, repo } = await deviceWithKeptData();
    const recovery = createRecovery({ db, repo });
    await recovery.load();
    expect(isAccountEmpty(recovery.getOffer()!)).toBe(true);
  });
});

describe('comparing with the account (docs/recovery-upload FR-168 – FR-170)', () => {
  it('drops the kept data without asking when the account already holds the same', async () => {
    const { db, repo, snapshot } = await deviceWithKeptData();
    await repo.restoreSnapshot(snapshot, 'append'); // another device uploaded the same data
    await db.outbox.clear();
    const recovery = createRecovery({ db, repo });
    const seen = vi.fn();
    recovery.subscribe(seen);
    await recovery.load();
    expect(recovery.getOffer()).toBeUndefined();
    expect(await db.getMeta(RECOVERY_KEY)).toBeUndefined();
    expect(await db.outbox.count()).toBe(0); // nothing to send: nothing changed
  });

  it('asks when the account holds something else', async () => {
    const { db, repo, snapshot, inbox } = await deviceWithKeptData();
    await repo.restoreSnapshot(snapshot, 'append');
    await repo.createTodo({ listId: inbox.id, title: 'added on the phone' });
    const recovery = createRecovery({ db, repo });
    await recovery.load();
    expect(recovery.getOffer()).toMatchObject({ todos: 2, accountTodos: 3 });
    expect(isAccountEmpty(recovery.getOffer()!)).toBe(false);
  });

  it('device newer (overwrite) leaves exactly the kept data; server newer (decline) leaves the account', async () => {
    for (const answer of ['device', 'server'] as const) {
      const { db, repo, inbox } = await deviceWithKeptData();
      await repo.createTodo({ listId: inbox.id, title: 'phone task' });
      const recovery = createRecovery({ db, repo });
      await recovery.load();
      if (answer === 'device') await recovery.accept('overwrite');
      else await recovery.decline();
      const titles = (await db.todos.toArray())
        .filter((t) => t.deletedAt === null)
        .map((t) => t.title)
        .sort();
      expect(titles).toEqual(answer === 'device' ? ['one', 'two'] : ['phone task']);
      expect(recovery.getOffer()).toBeUndefined();
    }
  });
});
