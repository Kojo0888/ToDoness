/** Plans between simulated browsers and the real server (docs/plan/PRD.md FR-142, FR-143). */
import { describe, expect, it } from 'vitest';
import { addDays, brokenLinks } from '@todoness/shared';
import { getActivities, getPlans } from '../../client/src/data/queries';
import { Browser, twoBrowsers } from './harness';

const shape = async (b: Browser, planId: string) =>
  Object.fromEntries((await getActivities(b.db, planId)).map((a) => [a.name, [a.start, a.days]]));

describe('plans sync', () => {
  it('a plan built offline, with links, reaches the other device after reconnecting', async () => {
    const { a, b } = await twoBrowsers();
    a.online = false;
    const plan = await a.repo.createPlan('Launch');
    const design = await a.repo.createActivity(plan.id, 'Design');
    a.time += 10;
    const build = await a.repo.createActivity(plan.id, 'Build');
    await a.repo.linkActivities(design.id, build.id);
    await a.repo.updateActivity(design.id, { days: 10 }); // pushes Build
    expect((await a.sync()).ok).toBe(false);

    a.online = true;
    expect(await a.sync()).toEqual({ ok: true });
    expect(await b.sync()).toEqual({ ok: true });
    expect((await getPlans(b.db)).map((p) => p.name)).toEqual(['Launch']);
    expect(await shape(b, plan.id)).toEqual(await shape(a, plan.id));
    expect((await b.db.activities.get(build.id))?.dependsOn).toEqual([design.id]);
    expect((await b.db.activities.get(build.id))?.start).toBe(addDays(design.start, 10));
  });

  it('changes made offline on two devices merge; a broken link is kept until the next change', async () => {
    const { a, b } = await twoBrowsers();
    const plan = await a.repo.createPlan('Launch');
    const design = await a.repo.createActivity(plan.id, 'Design'); // 3 days
    a.time += 10;
    const build = await a.repo.createActivity(plan.id, 'Build'); // right after
    await a.sync();
    await b.sync();

    a.online = false;
    b.online = false;
    a.time += 1000;
    b.time += 2000;
    await a.repo.linkActivities(design.id, build.id); // holds: nothing moves
    await b.repo.updateActivity(design.id, { days: 8 }); // b knows no link: nothing moves
    a.online = true;
    b.online = true;
    await a.sync();
    await b.sync();
    await a.sync();

    // Both devices agree, and both see that Build now starts too early (decision P7).
    expect(await shape(a, plan.id)).toEqual(await shape(b, plan.id));
    for (const x of [a, b]) {
      expect(brokenLinks(await getActivities(x.db, plan.id))).toEqual([
        { from: design.id, to: build.id },
      ]);
    }

    // The next change of dates or links in the plan repairs it, and the repair syncs.
    b.time += 1000;
    // A rename is not such a change: it moves nothing (review of PR 17).
    await b.repo.updateActivity(design.id, { name: 'Design it' });
    expect(brokenLinks(await getActivities(b.db, plan.id))).toHaveLength(1);
    // A change of dates is: Build's own duration here.
    await b.repo.updateActivity(build.id, { days: 4 });
    await b.sync();
    await a.sync();
    for (const x of [a, b]) {
      expect(brokenLinks(await getActivities(x.db, plan.id))).toEqual([]);
      expect((await x.db.activities.get(build.id))?.start).toBe(addDays(design.start, 8));
    }
  });

  it('deleting a plan on one device removes it and its activities on the other', async () => {
    const { a, b } = await twoBrowsers();
    const plan = await a.repo.createPlan('Launch');
    const design = await a.repo.createActivity(plan.id, 'Design');
    await a.sync();
    await b.sync();
    await b.repo.deletePlan(plan.id);
    await b.sync();
    await a.sync();
    expect(await getPlans(a.db)).toEqual([]);
    expect((await a.db.activities.get(design.id))?.deletedAt).not.toBeNull();
  });

  it('a device that skipped plans as an old app gets them after forgetting its cursor (FR-143)', async () => {
    const { a, b } = await twoBrowsers();
    const plan = await a.repo.createPlan('Launch');
    await a.repo.createActivity(plan.id, 'Design');
    const list = await a.repo.createList('Later list');
    await a.sync();

    // What the old app on `b` ends up with: everything but the plans, cursor at the end.
    await b.sync();
    const cursor = await b.db.getMeta<number>('lastServerSeq');
    await b.db.plans.clear();
    await b.db.activities.clear();
    expect(cursor).toBeGreaterThan(0);

    // The upgrade to the local database version 6 forgets the cursor.
    await b.db.meta.delete('lastServerSeq');
    expect(await b.sync()).toEqual({ ok: true });
    expect((await getPlans(b.db)).map((p) => p.name)).toEqual(['Launch']);
    expect(await shape(b, plan.id)).toEqual(await shape(a, plan.id));
    expect((await b.db.lists.get(list.id))?.name).toBe('Later list');
    expect(await b.db.getMeta<number>('lastServerSeq')).toBe(cursor);
    expect(await b.db.outbox.count()).toBe(0);
  });
});
