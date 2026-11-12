/** Changes on a plan page: undo point, order, errors (docs/plan/PRD.md FR-147). */
import { describe, expect, it } from 'vitest';
import { addDays, localDay, newId } from '@todoness/shared';
import { getActivities } from '../../src/data/queries';
import { RepoError } from '../../src/data/repo';
import { createPlanChanges } from '../../src/services/planChanges';
import { fakeNow, T0, testRepo } from '../helpers/db';

const TODAY = localDay(T0);

async function setup() {
  const now = fakeNow();
  const t = testRepo({ now });
  const plan = await t.repo.createPlan('Launch');
  const add = async (name: string, offset: number, days: number) => {
    now.advance(10);
    const a = await t.repo.createActivity(plan.id, name);
    return t.repo.updateActivity(a.id, { start: addDays(TODAY, offset), days });
  };
  const changes = createPlanChanges({ db: t.db, repo: t.repo, planId: plan.id });
  const get = async (id: string) => (await t.db.activities.get(id))!;
  return { ...t, now, plan, add, changes, get };
}

describe('plan changes', () => {
  it('remembers what a change did; undo puts it back once', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    expect(s.changes.getState()).toEqual({ undo: null, error: null });

    const saved = await s.changes.run(() => s.repo.updateActivity(a.id, { days: 5 }));
    expect(saved?.days).toBe(5);
    expect(s.changes.getState().undo).toEqual([
      { id: a.id, before: { days: 2 }, after: { days: 5 } },
    ]);

    await s.changes.undo();
    expect((await s.get(a.id)).days).toBe(2);
    expect(s.changes.getState().undo).toBeNull();
    await s.changes.undo(); // nothing left: no effect
    expect((await s.get(a.id)).days).toBe(2);
  });

  it('tells its listeners, and gives the same state object until something changes', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    let calls = 0;
    const off = s.changes.subscribe(() => calls++);
    const first = s.changes.getState();
    expect(s.changes.getState()).toBe(first);
    await s.changes.run(() => s.repo.updateActivity(a.id, { days: 5 }));
    expect(calls).toBeGreaterThan(0);
    expect(s.changes.getState()).not.toBe(first);
    off();
  });

  it('two changes started at once run one after the other: undo goes back one step (review)', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    // Two quick presses of ArrowRight: the second starts before the first has finished.
    const first = s.changes.run(async () =>
      s.repo.updateActivity(a.id, { start: addDays((await s.get(a.id)).start, 1) }),
    );
    const second = s.changes.run(async () =>
      s.repo.updateActivity(a.id, { start: addDays((await s.get(a.id)).start, 1) }),
    );
    await Promise.all([first, second]);
    expect((await s.get(a.id)).start).toBe(addDays(TODAY, 2));
    expect(s.changes.getState().undo).toEqual([
      { id: a.id, before: { start: addDays(TODAY, 1) }, after: { start: addDays(TODAY, 2) } },
    ]);
    await s.changes.undo();
    expect((await s.get(a.id)).start).toBe(addDays(TODAY, 1));
  });

  it('undo does not touch what was changed elsewhere after the change (review)', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    const b = await s.add('B', 5, 2);
    await s.changes.run(() => s.repo.updateActivity(a.id, { days: 4 }));
    // Not through `run`: as a sync from another device would change the plan.
    await s.repo.updateActivity(b.id, { start: addDays(TODAY, 30) });
    await s.repo.linkActivities(a.id, b.id);

    await s.changes.undo();
    expect((await s.get(a.id)).days).toBe(2);
    expect(await s.get(b.id)).toMatchObject({ start: addDays(TODAY, 30), dependsOn: [a.id] });
  });

  it('a change that alters no dates or links (a rename) keeps the undo point', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    await s.changes.run(() => s.repo.updateActivity(a.id, { days: 4 }));
    const point = s.changes.getState().undo;
    await s.changes.run(() => s.repo.updateActivity(a.id, { name: 'Renamed' }));
    expect(s.changes.getState().undo).toBe(point);
    expect((await getActivities(s.db, s.plan.id))[0]!.name).toBe('Renamed');
  });

  it('turns failures into an error to show, and resolves to undefined (review)', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    const b = await s.add('B', 5, 2);
    await s.changes.run(() => s.repo.linkActivities(a.id, b.id));

    expect(await s.changes.run(() => s.repo.linkActivities(b.id, a.id))).toBeUndefined();
    expect(s.changes.getState().error).toBe('loop');

    // Renaming, deleting or adding to something that is gone: a message, not a crash.
    await s.changes.run(() => s.repo.updateActivity(newId(), { name: 'x' }));
    expect(s.changes.getState().error).toBe('failed');
    await s.changes.run(() => s.repo.deleteActivity(newId()));
    expect(s.changes.getState().error).toBe('failed');
    await s.repo.deletePlan(s.plan.id);
    await s.changes.run(() => s.repo.createActivity(s.plan.id, 'Late'));
    expect(s.changes.getState().error).toBe('failed');
    await s.changes.run(async () => {
      throw new Error('anything');
    });
    expect(s.changes.getState().error).toBe('failed');

    // The next change that works takes the message away; so does clearError.
    s.changes.clearError();
    expect(s.changes.getState().error).toBeNull();
  });

  it('the undo point of an earlier change survives a failed one', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    await s.changes.run(() => s.repo.updateActivity(a.id, { days: 4 }));
    await s.changes.run(() => s.repo.updateActivity(a.id, { days: 0 }));
    expect(s.changes.getState().error).toBe('failed');
    await s.changes.undo();
    expect((await s.get(a.id)).days).toBe(2);
  });

  describe('auto sort (docs/plan-sort FR-193)', () => {
    it('sorts after a change, in the same undo step', async () => {
      const s = await setup();
      const a = await s.add('A', 0, 2);
      await s.add('B', 5, 1);
      let on = true;
      const changes = createPlanChanges({
        db: s.db,
        repo: s.repo,
        planId: s.plan.id,
        autoSort: () => on,
      });
      const names = async () => (await getActivities(s.db, s.plan.id)).map((x) => x.name);
      expect(await names()).toEqual(['A', 'B']);

      // A moves behind B: the rows follow by themselves.
      await changes.run(() => s.repo.updateActivity(a.id, { start: addDays(TODAY, 9) }));
      expect(await names()).toEqual(['B', 'A']);

      await changes.undo(); // one step takes back the move and the new order
      expect(await names()).toEqual(['A', 'B']);
      expect((await s.get(a.id)).start).toBe(TODAY);

      on = false;
      await changes.run(() => s.repo.updateActivity(a.id, { start: addDays(TODAY, 9) }));
      expect(await names()).toEqual(['A', 'B']); // off: no sorting
    });

    it('sorts only after a change of dates, links, groups or a new activity', async () => {
      const s = await setup();
      const a = await s.add('A', 0, 2);
      await s.add('B', 5, 1);
      const changes = createPlanChanges({
        db: s.db,
        repo: s.repo,
        planId: s.plan.id,
        autoSort: () => true,
      });
      let sorts = 0;
      const sort = s.repo.sortActivities;
      s.repo.sortActivities = (id) => (sorts++, sort(id));
      await changes.run(() => s.repo.updateActivity(a.id, { name: 'A2' }));
      await changes.run(() => s.repo.updateActivity(a.id, { days: 4 }));
      await changes.run(() => s.repo.updateActivity(a.id, { done: true }));
      expect(sorts).toBe(0);
      await changes.run(() => s.repo.updateActivity(a.id, { start: addDays(TODAY, 1) }));
      expect(sorts).toBe(1);
      await changes.run(() => s.repo.createActivity(s.plan.id, 'New'));
      expect(sorts).toBe(2);
    });

    it('reports a real failure of the sort and ignores a plan that is gone', async () => {
      const s = await setup();
      const a = await s.add('A', 0, 2);
      const changes = createPlanChanges({
        db: s.db,
        repo: s.repo,
        planId: s.plan.id,
        autoSort: () => true,
      });
      s.repo.sortActivities = () => Promise.reject(new RepoError('not_found'));
      await changes.run(() => s.repo.updateActivity(a.id, { start: addDays(TODAY, 3) }));
      expect(changes.getState().error).toBeNull();
      s.repo.sortActivities = () => Promise.reject(new Error('quota'));
      await changes.run(() => s.repo.updateActivity(a.id, { start: addDays(TODAY, 6) }));
      expect(changes.getState().error).toBe('failed');
    });

    it('a change of row order alone is an undo point only for a sort (sort())', async () => {
      const s = await setup();
      const a = await s.add('A', 0, 2);
      await s.add('B', 5, 1);
      const changes = createPlanChanges({ db: s.db, repo: s.repo, planId: s.plan.id });
      await changes.run(() => s.repo.updateActivity(a.id, { days: 5 }));
      const point = changes.getState().undo;
      // a move that only changes the rows leaves the earlier undo point alone
      await s.repo.updateActivity(a.id, { start: addDays(TODAY, 9) });
      await changes.run(() => s.repo.sortActivities(s.plan.id));
      expect(changes.getState().undo).toBe(point);
      // sort() records the new order as its own undo step
      await s.repo.updateActivity(a.id, { start: addDays(TODAY, 0) });
      await changes.sort();
      expect(changes.getState().undo).not.toBe(point);
      const names = async () => (await getActivities(s.db, s.plan.id)).map((x) => x.name);
      expect(await names()).toEqual(['A', 'B']);
      await s.repo.updateActivity(a.id, { start: addDays(TODAY, 9) });
      await changes.sort();
      expect(await names()).toEqual(['B', 'A']);
      await changes.undo();
      expect(await names()).toEqual(['A', 'B']);
    });

    it('does not sort after a failed change or after undo', async () => {
      const s = await setup();
      const a = await s.add('A', 0, 2);
      await s.add('B', 5, 1);
      const changes = createPlanChanges({
        db: s.db,
        repo: s.repo,
        planId: s.plan.id,
        autoSort: () => true,
      });
      await changes.run(() => s.repo.updateActivity(a.id, { start: addDays(TODAY, 9) }));
      const keys = (await getActivities(s.db, s.plan.id)).map((x) => x.orderKey);
      await changes.run(() => Promise.reject(new Error('boom')));
      expect((await getActivities(s.db, s.plan.id)).map((x) => x.orderKey)).toEqual(keys);
      expect(changes.getState().error).toBe('failed');
    });
  });
});
