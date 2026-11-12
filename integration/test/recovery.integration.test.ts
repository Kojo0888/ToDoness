/**
 * The server lost its database; a fresh one is set up; the user signs up again on a device
 * that still holds the old data (docs/v1/PRD.md section 4.11).
 */
import { describe, expect, it } from 'vitest';
import { RECOVERY_KEY, takeSnapshot } from '../../client/src/data/recovery';
import { createRecovery } from '../../client/src/services/recovery';
import { Browser, startServer, T0 } from './harness';

/** A device with a year of data, fully synced with the old server. */
async function oldAccount() {
  const oldServer = startServer();
  const a = new Browser(oldServer, 'laptop');
  await a.register('ann@corp.test');
  const inbox = await a.inboxId();
  const work = await a.repo.createList('Work');
  await a.repo.setListPublic(work.id, true);
  await a.repo.createTodo({ listId: inbox, title: 'Buy milk', notes: 'two litres' });
  const due = await a.repo.createTodo({ listId: work.id, title: 'Report', dueAt: T0 + 86_400_000 });
  await a.repo.updateTodo(due.id, { remindBefore: ['day', 'hour'], priority: 3 });
  const done = await a.repo.createTodo({ listId: work.id, title: 'Old news' });
  await a.repo.setDone(done.id, true);
  expect(await a.sync()).toEqual({ ok: true });
  return { a, work, inbox };
}

/** What the session does at sign-up: keep the data aside, clear, sign up, first sync. */
async function signUpAgain(a: Browser, server: ReturnType<typeof startServer>, email: string) {
  const snapshot = await takeSnapshot(a.db, email, () => a.time);
  await a.db.clearAll(snapshot ? [{ key: RECOVERY_KEY, value: snapshot }] : []);
  a.switchServer(server);
  await a.register(email);
  const recovery = createRecovery({ db: a.db, repo: a.repo });
  await recovery.load();
  return recovery;
}

describe('recovery after the server lost its database', () => {
  it('the fresh account is empty, and the offer says so', async () => {
    const { a } = await oldAccount();
    const recovery = await signUpAgain(a, startServer(), 'ann@corp.test');
    expect(recovery.getOffer()).toEqual({
      fromEmail: 'ann@corp.test',
      todos: 3,
      lists: 1,
      notes: 0,
      plans: 0,
      accountTodos: 0,
      accountLists: 0,
      accountNotes: 0,
      accountPlans: 0,
    });
  });

  it('append: everything is back on the server and on a second device', async () => {
    const { a } = await oldAccount();
    const fresh = startServer();
    const recovery = await signUpAgain(a, fresh, 'ann@corp.test');

    expect(await recovery.accept('append')).toEqual({
      ok: true,
      lists: 1,
      todos: 3,
      notes: 0,
      plans: 0,
    });
    expect(await a.sync()).toEqual({ ok: true });
    expect(await a.db.outbox.count()).toBe(0);

    const b = new Browser(fresh, 'phone');
    await b.login('ann@corp.test');
    await b.sync();
    expect(await b.snapshot()).toEqual(await a.snapshot());

    const lists = (await b.db.lists.toArray()).filter((l) => l.module !== 'notes' && !l.deletedAt);
    expect(lists.map((l) => l.name).sort()).toEqual(['Inbox', 'Work']);
    expect(lists.find((l) => l.name === 'Work')!.isPublic).toBe(true);
    expect(await b.titles(await b.inboxId())).toEqual(['Buy milk']); // in the NEW Inbox
    const work = lists.find((l) => l.name === 'Work')!;
    expect(await b.titles(work.id)).toEqual(['Report']);
    const report = (await b.db.todos.toArray()).find((t) => t.title === 'Report')!;
    expect(report).toMatchObject({
      remindBefore: ['day', 'hour'],
      priority: 3,
      dueAt: T0 + 86_400_000,
    });
    const old = (await b.db.todos.toArray()).find((t) => t.title === 'Old news')!;
    expect(old.done).toBe(true);
  });

  it('overwrite: replaces what another device already put into the new account', async () => {
    const { a } = await oldAccount();
    const fresh = startServer();
    const recovery = await signUpAgain(a, fresh, 'ann@corp.test');

    // Meanwhile Ann's phone logged into the new account and added things.
    const c = new Browser(fresh, 'phone');
    await c.login('ann@corp.test');
    await c.sync();
    await c.repo.createTodo({ listId: await c.inboxId(), title: 'Phone task' });
    const phoneList = await c.repo.createList('Phone list');
    await c.sync();
    await a.sync(); // the laptop sees them: the account is no longer empty
    await recovery.load();
    expect(recovery.getOffer()).toMatchObject({ accountTodos: 1, accountLists: 1 });

    expect(await recovery.accept('overwrite')).toMatchObject({ ok: true });
    await a.sync();
    await c.sync();

    expect(await c.titles(await c.inboxId())).toEqual(['Buy milk']);
    expect((await c.db.lists.get(phoneList.id))!.deletedAt).not.toBeNull();
    expect(
      (await c.db.lists.toArray())
        .filter((l) => !l.deletedAt && l.module !== 'notes')
        .map((l) => l.name)
        .sort(),
    ).toEqual(['Inbox', 'Work']);
    expect(await c.snapshot()).toEqual(await a.snapshot());
  });

  it('append keeps what another device put into the new account', async () => {
    const { a } = await oldAccount();
    const fresh = startServer();
    const recovery = await signUpAgain(a, fresh, 'ann@corp.test');
    const c = new Browser(fresh, 'phone');
    await c.login('ann@corp.test');
    await c.sync();
    await c.repo.createTodo({ listId: await c.inboxId(), title: 'Phone task' });
    await c.sync();
    await a.sync();

    await recovery.accept('append');
    await a.sync();
    await c.sync();
    expect((await c.titles(await c.inboxId())).sort()).toEqual(['Buy milk', 'Phone task']);
  });

  it('decline: the account stays empty and the data is gone for good', async () => {
    const { a } = await oldAccount();
    const fresh = startServer();
    const recovery = await signUpAgain(a, fresh, 'ann@corp.test');
    await recovery.decline();
    await a.sync();

    const b = new Browser(fresh, 'phone');
    await b.login('ann@corp.test');
    await b.sync();
    expect((await b.db.todos.toArray()).length).toBe(0);
    expect(
      (await b.db.lists.toArray()).filter((l) => l.module !== 'notes').map((l) => l.name),
    ).toEqual(['Inbox']);
    expect(await a.db.getMeta(RECOVERY_KEY)).toBeUndefined();
  });

  it('restoring while offline: the data is sent after the connection returns', async () => {
    const { a } = await oldAccount();
    const fresh = startServer();
    const recovery = await signUpAgain(a, fresh, 'ann@corp.test');

    a.online = false;
    expect(await recovery.accept('append')).toMatchObject({ ok: true });
    expect(await a.sync()).toMatchObject({ ok: false, kind: 'offline' });
    expect(await a.db.outbox.count()).toBeGreaterThan(0);

    a.online = true;
    expect(await a.sync()).toEqual({ ok: true });
    const b = new Browser(fresh, 'phone');
    await b.login('ann@corp.test');
    await b.sync();
    expect(await b.snapshot()).toEqual(await a.snapshot());
  });

  it('the same restore from a second device of the same user merges, nothing is duplicated', async () => {
    const { a } = await oldAccount();
    // The phone had a copy of the same data (it synced with the old server too).
    const oldServer = a.server;
    const phone = new Browser(oldServer, 'phone');
    await phone.login('ann@corp.test');
    await phone.sync();

    const fresh = startServer();
    const ra = await signUpAgain(a, fresh, 'ann@corp.test');
    await ra.accept('append');
    await a.sync();

    // The phone also kept a copy aside; it joins the new account and restores the same ids.
    const snapshot = await takeSnapshot(phone.db, 'ann@corp.test', () => phone.time);
    await phone.db.clearAll();
    phone.switchServer(fresh);
    await phone.login('ann@corp.test');
    await phone.sync();
    await phone.repo.restoreSnapshot(snapshot!, 'append');
    await phone.sync();
    await a.sync();

    const titles = (await a.db.todos.toArray()).filter((t) => !t.deletedAt).map((t) => t.title);
    expect(titles.sort()).toEqual(['Buy milk', 'Old news', 'Report']);
  });

  it('another device signed up first: the laptop logs in with the same e-mail and is offered its data', async () => {
    const { a } = await oldAccount();
    const fresh = startServer();

    // The phone (empty, new) signs up first on the fresh server and adds a task.
    const phone = new Browser(fresh, 'phone');
    await phone.register('ann@corp.test');
    await phone.repo.createTodo({ listId: await phone.inboxId(), title: 'Phone task' });
    await phone.sync();

    // The laptop logs in (what the session does for the same e-mail but a new user id).
    const snapshot = await takeSnapshot(a.db, 'ann@corp.test', () => a.time);
    await a.db.clearAll(snapshot ? [{ key: RECOVERY_KEY, value: snapshot }] : []);
    a.switchServer(fresh);
    await a.login('ann@corp.test');
    await a.sync();
    const recovery = createRecovery({ db: a.db, repo: a.repo });
    await recovery.load();
    expect(recovery.getOffer()).toMatchObject({ todos: 3, lists: 1, accountTodos: 1 });

    await recovery.accept('append');
    await a.sync();
    await phone.sync();
    expect((await phone.titles(await phone.inboxId())).sort()).toEqual(['Buy milk', 'Phone task']);
    expect(await phone.snapshot()).toEqual(await a.snapshot());
  });
});

describe('upload of every kind of data to an empty server (docs/recovery-upload FR-167)', () => {
  /** Live rows without clocks and timestamps, sorted: what the user sees. */
  async function visible(b: Browser) {
    const strip = <T extends { id: string; deletedAt: number | null }>(rows: T[]) =>
      rows
        .filter((r) => r.deletedAt === null)
        .sort((x, y) => x.id.localeCompare(y.id))
        .map((r) => {
          const copy: Record<string, unknown> = { ...r };
          delete copy.fieldHlc;
          delete copy.createdAt;
          delete copy.updatedAt;
          return copy;
        });
    return {
      lists: strip(await b.db.lists.toArray()).filter((l) => !l.isInbox),
      todos: strip(await b.db.todos.toArray()),
      notes: strip(await b.db.notes.toArray()),
      plans: strip(await b.db.plans.toArray()),
      activities: strip(await b.db.activities.toArray()),
    };
  }

  async function deviceWithEverything() {
    const old = startServer();
    const a = new Browser(old, 'laptop');
    await a.register('ann@corp.test');
    const inbox = await a.inboxId();
    const work = await a.repo.createList('Work');
    await a.repo.createTodo({ listId: inbox, title: 'Call the bank', notes: 'Ask about the fee' });
    const report = await a.repo.createTodo({ listId: work.id, title: 'Report', dueAt: T0 });
    await a.repo.updateTodo(report.id, { notes: 'Two pages\nwith a chart', priority: 2 });
    const ideas = await a.repo.createList('Ideas', 'notes');
    await a.repo.createNote('Loose note');
    const garden = await a.repo.createNote('Garden', ideas.id);
    await a.repo.setNotePublic(garden.id, true);
    const plan = await a.repo.createPlan('Launch');
    const design = await a.repo.createActivity(plan.id, 'Design');
    a.time += 10;
    const build = await a.repo.createActivity(plan.id, 'Build');
    await a.repo.updateActivity(build.id, { days: 5 });
    await a.repo.linkActivities(design.id, build.id);
    await a.repo.updateActivity(design.id, { done: true });
    expect(await a.sync()).toEqual({ ok: true });
    return { a, inbox };
  }

  it('everything the device holds reaches the fresh server and a second device', async () => {
    const { a, inbox: oldInbox } = await deviceWithEverything();
    const before = await visible(a);
    expect(before).toMatchObject({
      lists: { length: 2 },
      todos: { length: 2 },
      notes: { length: 2 },
      plans: { length: 1 },
      activities: { length: 2 },
    });

    const fresh = startServer();
    const recovery = await signUpAgain(a, fresh, 'ann@corp.test');
    expect(recovery.getOffer()).toMatchObject({
      todos: 2,
      lists: 2,
      notes: 2,
      plans: 1,
      accountTodos: 0,
      accountLists: 0,
      accountNotes: 0,
      accountPlans: 0,
    });
    expect(await recovery.accept('append')).toEqual({
      ok: true,
      lists: 2,
      todos: 2,
      notes: 2,
      plans: 1,
    });
    expect(await a.sync()).toEqual({ ok: true });
    expect(await a.db.outbox.count()).toBe(0);
    expect(await a.db.deadLetter.count()).toBe(0);

    const phone = new Browser(fresh, 'phone');
    await phone.login('ann@corp.test');
    await phone.sync();
    const after = await visible(phone);
    const newInbox = await phone.inboxId();
    // The only change: tasks of the old Inbox are in the new account's Inbox (FR-80).
    expect(after.todos).toEqual(
      before.todos.map((t) => (t.listId === oldInbox ? { ...t, listId: newInbox } : t)),
    );
    expect(after.lists).toEqual(before.lists);
    expect(after.notes).toEqual(before.notes);
    expect(after.plans).toEqual(before.plans);
    expect(after.activities).toEqual(before.activities);
    expect(await visible(a)).toEqual(after);
  });

  it('the upload made offline is sent once the connection is back, with nothing lost', async () => {
    const { a } = await deviceWithEverything();
    const before = await visible(a);
    const fresh = startServer();
    const recovery = await signUpAgain(a, fresh, 'ann@corp.test');
    a.online = false;
    await recovery.accept('append');
    expect((await a.sync()).ok).toBe(false);
    a.online = true;
    expect(await a.sync()).toEqual({ ok: true });

    const phone = new Browser(fresh, 'phone');
    await phone.login('ann@corp.test');
    await phone.sync();
    const after = await visible(phone);
    expect(after.notes).toEqual(before.notes);
    expect(after.activities).toEqual(before.activities);
    expect(after.todos.map((t) => [t.title, t.notes]).sort()).toEqual(
      before.todos.map((t) => [t.title, t.notes]).sort(),
    );
  });

  it('keep it empty: nothing reaches the server', async () => {
    const { a } = await deviceWithEverything();
    const fresh = startServer();
    const recovery = await signUpAgain(a, fresh, 'ann@corp.test');
    await recovery.decline();
    expect(await a.sync()).toEqual({ ok: true });
    const phone = new Browser(fresh, 'phone');
    await phone.login('ann@corp.test');
    await phone.sync();
    expect(await visible(phone)).toEqual({
      lists: [],
      todos: [],
      notes: [],
      plans: [],
      activities: [],
    });
  });
});
