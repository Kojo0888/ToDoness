/** Sorting the rows of a plan (docs/plan-sort FR-189 – FR-192). */
import { describe, expect, it } from 'vitest';
import { addDays, localDay } from '@todoness/shared';
import { getActivities } from '../../src/data/queries';
import { diffActivities } from '../../src/lib/planUndo';
import { expectValidOutbox, fakeNow, T0, testRepo } from '../helpers/db';

const TODAY = localDay(T0);

async function setup() {
  const now = fakeNow();
  const t = testRepo({ now });
  const plan = await t.repo.createPlan('Launch');
  const add = async (name: string, offset: number, days = 1) => {
    now.advance(10);
    const a = await t.repo.createActivity(plan.id, name);
    return t.repo.updateActivity(a.id, { start: addDays(TODAY, offset), days });
  };
  const names = async () => (await getActivities(t.db, plan.id)).map((a) => a.name);
  const shape = async () =>
    Object.fromEntries(
      (await getActivities(t.db, plan.id)).map((a) => [a.name, [a.start, a.days, a.parentId]]),
    );
  return { ...t, now, plan, add, names, shape };
}

describe('sortActivities', () => {
  it('puts the rows in start order and changes nothing else', async () => {
    const s = await setup();
    await s.add('C', 5);
    await s.add('A', 1);
    await s.add('B', 3);
    const before = await s.shape();
    expect(await s.names()).toEqual(['C', 'A', 'B']);

    expect(await s.repo.sortActivities(s.plan.id)).toBe(true);
    expect(await s.names()).toEqual(['A', 'B', 'C']);
    expect(await s.shape()).toEqual(before);
    await expectValidOutbox(s.db);
  });

  it('does nothing, and queues nothing, when the rows are in order', async () => {
    const s = await setup();
    await s.add('A', 1);
    await s.add('B', 3);
    const queued = (await s.db.outbox.count()) as number;
    expect(await s.repo.sortActivities(s.plan.id)).toBe(false);
    expect(await s.db.outbox.count()).toBe(queued);
  });

  it('writes keys only for the rows from the first difference on', async () => {
    const s = await setup();
    await s.add('A', 1);
    await s.add('C', 5);
    await s.add('B', 3);
    const keys = new Map((await getActivities(s.db, s.plan.id)).map((a) => [a.name, a.orderKey]));
    await s.repo.sortActivities(s.plan.id);
    const after = new Map((await getActivities(s.db, s.plan.id)).map((a) => [a.name, a.orderKey]));
    expect(after.get('A')).toBe(keys.get('A'));
  });

  it('keeps deleted rows out of the way and their keys unused; restore still works', async () => {
    const s = await setup();
    await s.add('C', 5);
    const gone = await s.add('Gone', 2);
    await s.add('A', 1);
    await s.repo.deleteActivity(gone.id);
    await s.repo.sortActivities(s.plan.id);
    expect(await s.names()).toEqual(['A', 'C']);
    await s.repo.restoreActivity(gone.id);
    expect((await s.names()).sort()).toEqual(['A', 'C', 'Gone']);
    const keys = (await s.db.activities.toArray()).map((a) => a.orderKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('sorts inside groups and keeps every child in its group', async () => {
    const s = await setup();
    const x = await s.add('X', 6);
    const y = await s.add('Y', 2);
    const z = await s.add('Z', 4);
    const w = await s.add('W', 1);
    const g = await s.repo.groupActivities(x.id, y.id); // group of X, Y
    await s.repo.moveToGroup(z.id, g.id); // Z joins it
    await s.repo.sortActivities(s.plan.id);
    const rows = await getActivities(s.db, s.plan.id);
    const name = (id: string | null | undefined) => rows.find((r) => r.id === id)?.name;
    const kids = rows.filter((r) => r.parentId === g.id).map((r) => r.name);
    expect(kids).toEqual(['Y', 'Z', 'X']);
    // W (day 1) is the first top-level row, the group (from day 2) follows
    const top = rows.filter((r) => !r.parentId).map((r) => r.name);
    expect(top).toEqual(['W', g.name]);
    expect(name(w.id)).toBe('W');
  });

  it('puts a predecessor above its successor', async () => {
    const s = await setup();
    const late = await s.add('Late', 9);
    const early = await s.add('Early', 1);
    await s.repo.linkActivities(late.id, early.id); // Early now starts after Late
    await s.repo.sortActivities(s.plan.id);
    expect(await s.names()).toEqual(['Late', 'Early']);
  });

  it('is one undo step: the old order comes back, newer changes stay', async () => {
    const s = await setup();
    await s.add('C', 5);
    await s.add('A', 1);
    await s.add('B', 3);
    const read = async () =>
      (await getActivities(s.db, s.plan.id)).map(
        ({ id, start, days, dependsOn, done, parentId, orderKey }) => ({
          id,
          start,
          days,
          dependsOn,
          done,
          parentId,
          orderKey,
        }),
      );
    const before = await read();
    await s.repo.sortActivities(s.plan.id);
    const changes = diffActivities(before, await read());
    expect(changes.length).toBeGreaterThan(0);
    await s.repo.revertActivities(changes);
    expect(await s.names()).toEqual(['C', 'A', 'B']);
  });

  it('undo never gives two rows the same key, even if a vacated key was reused', async () => {
    const s = await setup();
    await s.add('C', 5);
    await s.add('A', 1);
    await s.add('B', 3);
    const read = async () =>
      (await getActivities(s.db, s.plan.id)).map(
        ({ id, start, days, dependsOn, done, parentId, orderKey }) => ({
          id,
          start,
          days,
          dependsOn,
          done,
          parentId,
          orderKey,
        }),
      );
    const before = await read();
    await s.repo.sortActivities(s.plan.id);
    const changes = diffActivities(before, await read());
    // Another row (say, synced from another device) takes the key a moved row gave up.
    const moved = changes.find((c) => c.before.orderKey !== undefined)!;
    const other = (await getActivities(s.db, s.plan.id)).find((a) => a.id !== moved.id)!;
    await s.db.activities.update(other.id, { orderKey: moved.before.orderKey! });
    await s.repo.revertActivities(changes);
    const keys = (await getActivities(s.db, s.plan.id)).map((a) => a.orderKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('fails for a plan that does not exist', async () => {
    const s = await setup();
    await expect(s.repo.sortActivities('nope')).rejects.toMatchObject({ code: 'not_found' });
  });
});
