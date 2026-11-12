/** Plans and activities in the local database (docs/plan/PRD.md). */
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_LINKS_MAX,
  addDays,
  ignoredLinks,
  liveLinks,
  localDay,
  newId,
  type Activity,
} from '@todoness/shared';
import { diffActivities } from '../../src/lib/planUndo';
import { applyChanges } from '../../src/sync/apply-changes';
import { RepoError } from '../../src/data/repo';
import { getActivities, getPlanById, getPlans } from '../../src/data/queries';
import { expectValidOutbox, fakeNow, T0, testRepo } from '../helpers/db';
import { hlcAt } from '../helpers/fetch';

const TODAY = localDay(T0);

async function setup() {
  const now = fakeNow();
  const t = testRepo({ now });
  const plan = await t.repo.createPlan('Launch');
  const acts = async () => getActivities(t.db, plan.id);
  /** name -> [start, days] of the plan's activities. */
  const shape = async () =>
    Object.fromEntries((await acts()).map((a) => [a.name, [a.start, a.days]]));
  /** An activity at a known place: `offset` days after today. */
  const add = async (name: string, offset: number, days: number) => {
    now.advance(10);
    const a = await t.repo.createActivity(plan.id, name);
    return t.repo.updateActivity(a.id, { start: addDays(TODAY, offset), days });
  };
  const outboxSince = async (count: number) => (await expectValidOutbox(t.db)).length - count;
  return { ...t, now, plan, acts, shape, add, outboxSince };
}

describe('plans – repo', () => {
  it('creates plans at the end and queues valid creates', async () => {
    const s = await setup();
    s.now.advance(10);
    const second = await s.repo.createPlan('  Move house ');
    expect((await getPlans(s.db)).map((p) => p.name)).toEqual(['Launch', 'Move house']);
    expect(second).toMatchObject({ name: 'Move house', deletedAt: null });
    const ops = await expectValidOutbox(s.db);
    expect(ops.map((o) => [o.entity, o.type])).toEqual([
      ['plan', 'create'],
      ['plan', 'create'],
    ]);
  });

  it('refuses a blank name', async () => {
    const s = await setup();
    await expect(s.repo.createPlan('   ')).rejects.toBeInstanceOf(RepoError);
    await expect(s.repo.renamePlan(s.plan.id, '')).rejects.toBeInstanceOf(RepoError);
  });

  it('renames a plan', async () => {
    const s = await setup();
    await s.repo.renamePlan(s.plan.id, 'Launch 2');
    expect((await getPlanById(s.db, s.plan.id))?.name).toBe('Launch 2');
    await expect(s.repo.renamePlan(newId(), 'x')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('deletes a plan together with its activities', async () => {
    const s = await setup();
    const a = await s.repo.createActivity(s.plan.id, 'Design');
    const other = await s.repo.createPlan('Other');
    const kept = await s.repo.createActivity(other.id, 'Stay');

    await s.repo.deletePlan(s.plan.id);
    expect(await getPlanById(s.db, s.plan.id)).toBeUndefined();
    expect((await s.db.activities.get(a.id))?.deletedAt).not.toBeNull();
    expect((await s.db.activities.get(kept.id))?.deletedAt).toBeNull();
    expect((await getPlans(s.db)).map((p) => p.name)).toEqual(['Other']);
    await expectValidOutbox(s.db);
  });
});

describe('activities – repo', () => {
  it('the first activity starts today and lasts 3 days; the next follows the last end (FR-124)', async () => {
    const s = await setup();
    const a = await s.repo.createActivity(s.plan.id, ' Design ');
    expect(a).toMatchObject({
      planId: s.plan.id,
      name: 'Design',
      start: TODAY,
      days: 3,
      dependsOn: [],
    });
    s.now.advance(10);
    const b = await s.repo.createActivity(s.plan.id, 'Build');
    expect(b).toMatchObject({ start: addDays(TODAY, 3), days: 3, dependsOn: [] });
    expect((await s.acts()).map((x) => x.name)).toEqual(['Design', 'Build']);
  });

  it('refuses a blank name and an unknown or deleted plan', async () => {
    const s = await setup();
    await expect(s.repo.createActivity(s.plan.id, '  ')).rejects.toBeInstanceOf(RepoError);
    await expect(s.repo.createActivity(newId(), 'x')).rejects.toMatchObject({ code: 'not_found' });
    await s.repo.deletePlan(s.plan.id);
    await expect(s.repo.createActivity(s.plan.id, 'x')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('changes name, start and duration; refuses bad values; does nothing when unchanged', async () => {
    const s = await setup();
    const a = await s.repo.createActivity(s.plan.id, 'Design');
    await s.repo.updateActivity(a.id, { name: 'Sketch' });
    await s.repo.updateActivity(a.id, { start: '2026-03-02' });
    const after = await s.repo.updateActivity(a.id, { days: 10 });
    expect(after).toMatchObject({ name: 'Sketch', start: '2026-03-02', days: 10 });

    const queued = (await expectValidOutbox(s.db)).length;
    await s.repo.updateActivity(a.id, { name: 'Sketch', start: '2026-03-02', days: 10 });
    expect(await s.outboxSince(queued)).toBe(0);

    await expect(s.repo.updateActivity(a.id, { days: 0 })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(s.repo.updateActivity(a.id, { start: '2026-02-31' })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(s.repo.updateActivity(a.id, { name: ' ' })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(s.repo.updateActivity(newId(), { days: 2 })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('deletes and restores an activity (both idempotent)', async () => {
    const s = await setup();
    const a = await s.repo.createActivity(s.plan.id, 'Design');
    await s.repo.deleteActivity(a.id);
    await s.repo.deleteActivity(a.id);
    expect(await s.acts()).toEqual([]);
    await s.repo.restoreActivity(a.id);
    await s.repo.restoreActivity(a.id);
    expect((await s.acts()).map((x) => x.name)).toEqual(['Design']);
    const ops = (await expectValidOutbox(s.db)).sort((x, y) => (x.hlc < y.hlc ? -1 : 1));
    expect(ops.filter((o) => o.entity === 'activity').map((o) => o.type)).toEqual([
      'create',
      'delete',
      'restore',
    ]);
  });
});

describe('dependencies – repo (FR-133 – FR-138)', () => {
  it('links two activities and pushes the successor behind the predecessor', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 5); // days 0 – 4
    const b = await s.add('B', 2, 2);
    const linked = await s.repo.linkActivities(a.id, b.id);
    expect(linked).toMatchObject({
      id: b.id,
      dependsOn: [a.id],
      start: addDays(TODAY, 5),
      days: 2,
    });
    expect(await s.shape()).toEqual({ A: [TODAY, 5], B: [addDays(TODAY, 5), 2] });
  });

  it('does not move a successor that already starts late enough', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    const b = await s.add('B', 10, 2);
    await s.repo.linkActivities(a.id, b.id);
    expect((await s.shape()).B).toEqual([addDays(TODAY, 10), 2]);
  });

  it('linking twice changes nothing', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    const b = await s.add('B', 10, 2);
    await s.repo.linkActivities(a.id, b.id);
    const queued = (await expectValidOutbox(s.db)).length;
    await s.repo.linkActivities(a.id, b.id);
    expect(await s.outboxSince(queued)).toBe(0);
    expect((await s.db.activities.get(b.id))?.dependsOn).toEqual([a.id]);
  });

  it('refuses a loop, a link to itself and a link into another plan', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    const b = await s.add('B', 5, 2);
    const c = await s.add('C', 9, 2);
    await s.repo.linkActivities(a.id, b.id);
    await s.repo.linkActivities(b.id, c.id);
    await expect(s.repo.linkActivities(c.id, a.id)).rejects.toMatchObject({ code: 'loop' });
    await expect(s.repo.linkActivities(a.id, a.id)).rejects.toMatchObject({ code: 'loop' });

    const other = await s.repo.createPlan('Other');
    const far = await s.repo.createActivity(other.id, 'Far');
    await expect(s.repo.linkActivities(a.id, far.id)).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.repo.linkActivities(a.id, newId())).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await s.db.activities.get(a.id))?.dependsOn).toEqual([]);
  });

  it('making a predecessor longer pushes the whole chain, in one go', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2); // 0 – 1
    const b = await s.add('B', 2, 3); // 2 – 4
    const c = await s.add('C', 5, 1); // 5
    const free = await s.add('Free', 1, 1);
    await s.repo.linkActivities(a.id, b.id);
    await s.repo.linkActivities(b.id, c.id);
    const queued = (await expectValidOutbox(s.db)).length;

    await s.repo.updateActivity(a.id, { days: 6 }); // 0 – 5
    expect(await s.shape()).toEqual({
      A: [TODAY, 6],
      B: [addDays(TODAY, 6), 3],
      C: [addDays(TODAY, 9), 1],
      Free: [addDays(TODAY, 1), 1],
    });
    // One update for A and one `start` update for each pushed activity.
    const ops = (await expectValidOutbox(s.db)).sort((x, y) => (x.hlc < y.hlc ? -1 : 1));
    expect(ops.slice(queued).map((o) => [o.entityId, o.patch])).toEqual([
      [a.id, { days: 6 }],
      [b.id, { start: addDays(TODAY, 6) }],
      [c.id, { start: addDays(TODAY, 9) }],
    ]);
    expect(free.id).toBeTruthy();
  });

  it('a successor dragged before the end of its predecessor lands right after it', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 4); // 0 – 3
    const b = await s.add('B', 10, 2);
    await s.repo.linkActivities(a.id, b.id);
    const moved = await s.repo.updateActivity(b.id, { start: addDays(TODAY, -3) });
    expect(moved.start).toBe(addDays(TODAY, 4));
  });

  it('shortening a predecessor pulls nothing earlier (decision P8)', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 4);
    const b = await s.add('B', 4, 2);
    await s.repo.linkActivities(a.id, b.id);
    await s.repo.updateActivity(a.id, { days: 1 });
    expect((await s.shape()).B).toEqual([addDays(TODAY, 4), 2]);
  });

  it('unlinks; a deleted predecessor no longer holds its successor, and does again after restore', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 4);
    const b = await s.add('B', 4, 2);
    const c = await s.add('C', 6, 2);
    await s.repo.linkActivities(a.id, b.id);
    await s.repo.linkActivities(a.id, c.id);

    const unlinked = await s.repo.unlinkActivities(a.id, b.id);
    expect(unlinked.dependsOn).toEqual([]);
    expect((await s.repo.updateActivity(b.id, { start: TODAY })).start).toBe(TODAY);

    await s.repo.deleteActivity(a.id);
    expect((await s.repo.updateActivity(c.id, { start: TODAY })).start).toBe(TODAY);
    await s.repo.restoreActivity(a.id);
    expect((await s.db.activities.get(c.id))?.start).toBe(addDays(TODAY, 4));
  });
});

describe('plans – pulled changes and clearing', () => {
  it('applies pulled plans and activities, merges with a newer local edit, and repairs nothing by itself', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    const remoteId = newId();
    let seq = 100;
    const change = (over: Record<string, unknown>) => ({
      serverSeq: ++seq,
      entity: 'activity' as const,
      type: 'update' as const,
      hlc: hlcAt(T0 + 60_000),
      entityId: a.id,
      patch: {},
      ...over,
    });
    s.now.advance(120_000);
    await s.repo.updateActivity(a.id, { name: 'Local name' }); // newer than the pulled one

    await applyChanges(
      s.db,
      [
        change({ patch: { name: 'Remote name', days: 9 } }),
        change({
          entityId: remoteId,
          type: 'create',
          // Starts while A is still running: broken, and left alone (decision P7).
          patch: {
            planId: s.plan.id,
            name: 'Remote',
            start: TODAY,
            orderKey: 'zz',
            dependsOn: [a.id],
          },
        }),
        {
          serverSeq: ++seq,
          entity: 'plan' as const,
          type: 'update' as const,
          hlc: hlcAt(T0 + 60_000),
          entityId: s.plan.id,
          patch: { name: 'Renamed elsewhere' },
        },
      ],
      seq,
    );

    expect(await s.db.activities.get(a.id)).toMatchObject({ name: 'Local name', days: 9 });
    expect(await s.db.activities.get(remoteId)).toMatchObject({ start: TODAY, dependsOn: [a.id] });
    expect((await getPlanById(s.db, s.plan.id))?.name).toBe('Renamed elsewhere');
  });

  it('clearAll removes plans and activities', async () => {
    const s = await setup();
    await s.repo.createActivity(s.plan.id, 'Design');
    await s.db.clearAll();
    expect(await s.db.plans.count()).toBe(0);
    expect(await s.db.activities.count()).toBe(0);
  });

  it('lists the activities of a plan in row order, without deleted ones', async () => {
    const s = await setup();
    const names: string[] = [];
    for (const n of ['One', 'Two', 'Three']) {
      s.now.advance(10);
      names.push((await s.repo.createActivity(s.plan.id, n)).name);
    }
    const all: Activity[] = await s.acts();
    await s.repo.deleteActivity(all[1]!.id);
    expect((await s.acts()).map((x) => x.name)).toEqual(['One', 'Three']);
  });
});

describe('reorderPlan (Manage plans, FR-121)', () => {
  it('puts a plan before another one, or at the end, with one order-key update', async () => {
    const s = await setup();
    const names = async () => (await getPlans(s.db)).map((p) => p.name);
    s.now.advance(10);
    const b = await s.repo.createPlan('B');
    s.now.advance(10);
    const c = await s.repo.createPlan('C');
    expect(await names()).toEqual(['Launch', 'B', 'C']);

    await s.repo.reorderPlan(c.id, s.plan.id);
    expect(await names()).toEqual(['C', 'Launch', 'B']);
    await s.repo.reorderPlan(c.id, null);
    expect(await names()).toEqual(['Launch', 'B', 'C']);

    const queued = (await expectValidOutbox(s.db)).length;
    await s.repo.reorderPlan(b.id, c.id); // already there
    expect(await s.outboxSince(queued)).toBe(0);
    await expect(s.repo.reorderPlan(b.id, newId())).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('revertActivities (Undo last change, FR-147)', () => {
  type S = Awaited<ReturnType<typeof setup>>;
  const snapshot = async (s: S) =>
    (await s.acts()).map(({ id, start, days, dependsOn }) => ({ id, start, days, dependsOn }));
  /** Runs a change and returns what it did, as the plan page does. */
  async function changed(s: S, run: () => Promise<unknown>) {
    const before = await snapshot(s);
    await run();
    return diffActivities(before, await snapshot(s));
  }

  it('puts back a drag together with everything it pushed', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    const b = await s.add('B', 2, 3);
    const c = await s.add('C', 5, 1);
    await s.repo.linkActivities(a.id, b.id);
    await s.repo.linkActivities(b.id, c.id);
    const shapeBefore = await s.shape();

    const diff = await changed(s, () => s.repo.updateActivity(a.id, { days: 9 }));
    expect(await s.shape()).not.toEqual(shapeBefore);
    const queued = (await expectValidOutbox(s.db)).length;
    await s.repo.revertActivities(diff);
    expect(await s.shape()).toEqual(shapeBefore);
    // Only what differed is written: A's duration and the two pushed starts.
    expect(await s.outboxSince(queued)).toBe(3);
  });

  it('takes a new link away again and brings a removed one back', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 5);
    const b = await s.add('B', 1, 2);
    const linked = await changed(s, () => s.repo.linkActivities(a.id, b.id)); // pushes B
    await s.repo.revertActivities(linked);
    expect(await s.db.activities.get(b.id)).toMatchObject({
      dependsOn: [],
      start: addDays(TODAY, 1),
    });

    await s.repo.linkActivities(a.id, b.id);
    const unlinked = await changed(s, () => s.repo.unlinkActivities(a.id, b.id));
    await s.repo.revertActivities(unlinked);
    expect((await s.db.activities.get(b.id))?.dependsOn).toEqual([a.id]);
  });

  it('leaves alone what was changed again since, here or on another device (review)', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    const b = await s.add('B', 5, 2);
    const c = await s.add('C', 9, 2);
    const d = await s.add('D', 12, 2);
    const diff = await changed(s, () => s.repo.updateActivity(a.id, { days: 4 }));
    expect(diff.map((x) => x.id)).toEqual([a.id]);

    // Meanwhile: B moved and C → D linked (another device), and A itself moved.
    await s.repo.updateActivity(b.id, { start: addDays(TODAY, 20) });
    await s.repo.linkActivities(c.id, d.id);
    await s.repo.updateActivity(a.id, { start: addDays(TODAY, 1) });

    await s.repo.revertActivities(diff);
    expect(await s.db.activities.get(a.id)).toMatchObject({ days: 2, start: addDays(TODAY, 1) });
    expect((await s.db.activities.get(b.id))?.start).toBe(addDays(TODAY, 20));
    expect((await s.db.activities.get(d.id))?.dependsOn).toEqual([c.id]);
  });

  it('does not put back a field that somebody changed after the change to undo', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    const diff = await changed(s, () => s.repo.updateActivity(a.id, { days: 4 }));
    await s.repo.updateActivity(a.id, { days: 7 }); // a newer edit of the same field
    const queued = (await expectValidOutbox(s.db)).length;
    await s.repo.revertActivities(diff);
    expect((await s.db.activities.get(a.id))?.days).toBe(7);
    expect(await s.outboxSince(queued)).toBe(0);
  });

  it('skips activities that were deleted meanwhile', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    const diff = await changed(s, () => s.repo.updateActivity(a.id, { days: 3 }));
    await s.repo.deleteActivity(a.id);
    await s.repo.revertActivities(diff);
    expect(await s.db.activities.get(a.id)).toMatchObject({ days: 3 });
  });
});

describe('review fixes – repo', () => {
  it('a change can be worked out from the stored activity, so quick repeats add up', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    // Two key presses before the screen has caught up: each builds on what is stored.
    const step = () => s.repo.updateActivity(a.id, (now) => ({ start: addDays(now.start, 1) }));
    await Promise.all([step(), step()]);
    expect((await s.db.activities.get(a.id))?.start).toBe(addDays(TODAY, 2));
  });

  /** Stores a state as a merge from another device could leave it. */
  const force = (s: Awaited<ReturnType<typeof setup>>, id: string, patch: Partial<Activity>) =>
    s.db.activities.update(id, patch);

  it('renaming an activity moves nothing, also when a link is broken (FR-139)', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 5);
    const b = await s.add('B', 10, 2);
    const c = await s.add('C', 20, 1);
    await s.repo.linkActivities(a.id, b.id);
    await force(s, b.id, { start: addDays(TODAY, 2) }); // broken by a merge
    const queued = (await expectValidOutbox(s.db)).length;

    await s.repo.updateActivity(c.id, { name: 'C renamed' });
    expect((await s.db.activities.get(b.id))?.start).toBe(addDays(TODAY, 2));
    expect(await s.outboxSince(queued)).toBe(1); // the rename only

    // A change of dates still repairs the plan.
    await s.repo.updateActivity(c.id, { days: 2 });
    expect((await s.db.activities.get(b.id))?.start).toBe(addDays(TODAY, 5));
  });

  it('a stored link that does not count (it closed a loop) is not "already linked"', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    const b = await s.add('B', 5, 2);
    await s.repo.linkActivities(a.id, b.id);
    // A merge left the opposite link stored as well; one of the two is ignored.
    await force(s, a.id, { dependsOn: [b.id] });
    const all = await s.acts();
    const [kept] = liveLinks(all);
    const [dropped] = ignoredLinks(all);
    expect(dropped).toEqual({ from: kept!.to, to: kept!.from });

    // Asking for the ignored one is refused as a loop, not silently "done".
    await expect(s.repo.linkActivities(dropped!.from, dropped!.to)).rejects.toMatchObject({
      code: 'loop',
    });

    // Removing the visible arrow also clears the hidden one: no arrow appears by itself…
    await s.repo.unlinkActivities(kept!.from, kept!.to);
    expect(liveLinks(await s.acts())).toEqual([]);
    expect((await s.acts()).map((x) => x.dependsOn)).toEqual([[], []]);
    // …and now the opposite link can be made.
    await s.repo.linkActivities(dropped!.from, dropped!.to);
    expect(liveLinks(await s.acts())).toEqual([dropped]);
  });

  it('dead ids do not use up the link limit; a full list is refused with its own error', async () => {
    const s = await setup();
    const target = await s.add('Target', 30, 1);
    const a = await s.add('A', 0, 1);
    const dead = Array.from({ length: ACTIVITY_LINKS_MAX }, () => newId());
    await force(s, target.id, { dependsOn: dead });

    const linked = await s.repo.linkActivities(a.id, target.id);
    expect(linked.dependsOn).toEqual([a.id]); // the dead ids made room
    await expectValidOutbox(s.db);

    // 50 real predecessors: the next one does not fit.
    const preds: string[] = [];
    for (let i = 0; i < ACTIVITY_LINKS_MAX; i++) preds.push((await s.add(`P${i}`, 0, 1)).id);
    await force(s, target.id, { dependsOn: preds });
    const queued = (await expectValidOutbox(s.db)).length;
    await expect(s.repo.linkActivities(a.id, target.id)).rejects.toMatchObject({ code: 'limit' });
    expect(await s.outboxSince(queued)).toBe(0);
  });
});
