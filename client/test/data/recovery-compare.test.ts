/**
 * Is the data kept on the device the same as the account's? (docs/recovery-upload FR-168,
 * decision U3: the same = uploading it would change nothing.)
 */
import { describe, expect, it } from 'vitest';
import { newId } from '@todoness/shared';
import { sameData, takeSnapshot, type RecoverySnapshot } from '../../src/data/recovery';
import { createRepo } from '../../src/data/repo';
import { fakeNow, seedInbox, testDb, T0 } from '../helpers/db';

/** A device with every kind of data, and its kept copy. */
async function device() {
  const db = testDb();
  const now = fakeNow();
  const repo = createRepo(db, { now });
  const inbox = await seedInbox(db);
  const work = await repo.createList('Work');
  await repo.createTodo({ listId: inbox.id, title: 'Inbox task', notes: 'a note' });
  const report = await repo.createTodo({ listId: work.id, title: 'Report' });
  await repo.updateTodo(report.id, { remindBefore: ['day'], priority: 2, dueAt: T0 });
  const ideas = await repo.createList('Ideas', 'notes');
  await repo.createNote('In ideas', ideas.id);
  await repo.createNote('Loose');
  const plan = await repo.createPlan('Launch');
  const design = await repo.createActivity(plan.id, 'Design');
  now.advance(10);
  const build = await repo.createActivity(plan.id, 'Build');
  await repo.linkActivities(design.id, build.id);
  await repo.updateActivity(design.id, { done: true });
  return { db, repo, kept: (await takeSnapshot(db, 'ann@corp.test'))! };
}

/** A new account (its own Inbox) after uploading `kept` into it. */
async function accountAfterUpload(kept: RecoverySnapshot) {
  const db = testDb();
  const repo = createRepo(db, { now: fakeNow(T0 + 50_000) });
  await seedInbox(db, newId(T0 + 40_000));
  await repo.restoreSnapshot(kept, 'append');
  return { db, repo, account: () => takeSnapshot(db, 'ann@corp.test') };
}

describe('sameData', () => {
  it('the account after uploading the kept data is the same (new Inbox, new clocks)', async () => {
    const { kept } = await device();
    const { account } = await accountAfterUpload(kept);
    expect(sameData(kept, (await account())!)).toBe(true);
  });

  it('a copy is the same as itself, whatever the order of the rows', async () => {
    const { kept } = await device();
    const shuffled: RecoverySnapshot = {
      ...kept,
      todos: [...kept.todos].reverse(),
      lists: [...kept.lists].reverse(),
      activities: [...(kept.activities ?? [])].reverse(),
    };
    expect(sameData(kept, shuffled)).toBe(true);
  });

  it('a copy from before done activities equals one where nothing is done', async () => {
    const { kept } = await device();
    const legacy = {
      ...kept,
      activities: kept.activities!.map((a) => {
        if (a.done) return a;
        const rest: Partial<typeof a> = { ...a };
        delete rest.done;
        return rest as typeof a;
      }),
    };
    expect(sameData(kept, legacy)).toBe(true);
  });

  it.each([
    [
      'a task title',
      async (r: Awaited<ReturnType<typeof accountAfterUpload>>) => {
        const t = (await r.db.todos.toArray()).find((x) => x.title === 'Report')!;
        await r.repo.updateTodo(t.id, { title: 'Report v2' });
      },
    ],
    [
      'a task note',
      async (r: Awaited<ReturnType<typeof accountAfterUpload>>) => {
        const t = (await r.db.todos.toArray()).find((x) => x.title === 'Inbox task')!;
        await r.repo.updateTodo(t.id, { notes: 'changed' });
      },
    ],
    [
      'a task done',
      async (r: Awaited<ReturnType<typeof accountAfterUpload>>) => {
        const t = (await r.db.todos.toArray()).find((x) => x.title === 'Report')!;
        await r.repo.setDone(t.id, true);
      },
    ],
    [
      'an extra task',
      async (r: Awaited<ReturnType<typeof accountAfterUpload>>) => {
        const inbox = (await r.db.lists.toArray()).find((l) => l.isInbox && l.module === 'tasks')!;
        await r.repo.createTodo({ listId: inbox.id, title: 'More' });
      },
    ],
    [
      'a deleted list',
      async (r: Awaited<ReturnType<typeof accountAfterUpload>>) => {
        const l = (await r.db.lists.toArray()).find((x) => x.name === 'Work')!;
        await r.repo.deleteList(l.id);
      },
    ],
    [
      'a note text',
      async (r: Awaited<ReturnType<typeof accountAfterUpload>>) => {
        const n = (await r.db.notes.toArray()).find((x) => x.text === 'Loose')!;
        await r.repo.updateNoteText(n.id, 'Tight');
      },
    ],
    [
      'a plan name',
      async (r: Awaited<ReturnType<typeof accountAfterUpload>>) => {
        const p = (await r.db.plans.toArray())[0]!;
        await r.repo.renamePlan(p.id, 'Launch 2');
      },
    ],
    [
      'an activity length',
      async (r: Awaited<ReturnType<typeof accountAfterUpload>>) => {
        const a = (await r.db.activities.toArray()).find((x) => x.name === 'Build')!;
        await r.repo.updateActivity(a.id, { days: 9 });
      },
    ],
    [
      'a removed link',
      async (r: Awaited<ReturnType<typeof accountAfterUpload>>) => {
        const all = await r.db.activities.toArray();
        const build = all.find((x) => x.name === 'Build')!;
        await r.repo.unlinkActivities(build.dependsOn[0]!, build.id);
      },
    ],
  ])('differs after a change of %s on the server', async (_what, change) => {
    const { kept } = await device();
    const after = await accountAfterUpload(kept);
    await change(after);
    expect(sameData(kept, (await after.account())!)).toBe(false);
  });

  it('data of the same shape but other ids is not the same (it was made separately)', async () => {
    const a = await device();
    const b = await device();
    expect(sameData(a.kept, b.kept)).toBe(false);
  });
});
