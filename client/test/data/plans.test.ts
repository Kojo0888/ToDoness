/** Plans and activities in the local database (docs/plan/PRD.md). */
import { describe, expect, it } from 'vitest';
import { addDays, localDay, newId, type Activity } from '@todoness/shared';
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
    const ops = await expectValidOutbox(s.db);
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
