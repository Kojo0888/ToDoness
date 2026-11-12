/** Plans in the recovery after a server loss (docs/plan/PRD.md FR-144). */
import { describe, expect, it } from 'vitest';
import { newId } from '@todoness/shared';
import { RECOVERY_KEY, takeSnapshot, type RecoverySnapshot } from '../../src/data/recovery';
import { createRepo } from '../../src/data/repo';
import { getActivities, getPlans } from '../../src/data/queries';
import { createRecovery } from '../../src/services/recovery';
import { expectValidOutbox, fakeNow, seedInbox, testDb, T0 } from '../helpers/db';

async function oldDevice() {
  const db = testDb();
  const now = fakeNow();
  const repo = createRepo(db, { now });
  await seedInbox(db);
  const plan = await repo.createPlan('Launch');
  const design = await repo.createActivity(plan.id, 'Design');
  now.advance(10);
  const build = await repo.createActivity(plan.id, 'Build');
  await repo.linkActivities(design.id, build.id);
  await repo.updateActivity(design.id, { done: true });
  const dropped = await repo.createActivity(plan.id, 'Dropped');
  await repo.deleteActivity(dropped.id);
  const gonePlan = await repo.createPlan('Gone');
  await repo.createActivity(gonePlan.id, 'Orphan');
  await repo.deletePlan(gonePlan.id);
  await db.outbox.clear();
  return { db, repo, plan, design, build };
}

async function freshAccount() {
  const db = testDb();
  const repo = createRepo(db, { now: fakeNow(T0 + 1000) });
  await seedInbox(db, newId(T0 + 5_000));
  return { db, repo };
}

describe('takeSnapshot with plans', () => {
  it('keeps live plans and the live activities of live plans; a device with only plans has something to restore', async () => {
    const old = await oldDevice();
    const snap = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    expect(snap.plans!.map((p) => p.name)).toEqual(['Launch']);
    expect(snap.activities!.map((a) => a.name).sort()).toEqual(['Build', 'Design']);
    expect(snap.todos).toEqual([]);
  });
});

describe('restoreSnapshot with plans', () => {
  it('append: brings plans and activities back with ids, days and links', async () => {
    const old = await oldDevice();
    const snap = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    const fresh = await freshAccount();
    const mine = await fresh.repo.createPlan('Already here');

    const counts = await fresh.repo.restoreSnapshot(snap, 'append');
    expect(counts).toMatchObject({ plans: 1 });
    expect((await getPlans(fresh.db)).map((p) => p.id).sort()).toEqual(
      [mine.id, old.plan.id].sort(),
    );
    const acts = await getActivities(fresh.db, old.plan.id);
    expect(acts.map((a) => a.name)).toEqual(['Design', 'Build']);
    expect(acts.map((a) => a.done)).toEqual([true, false]); // Update 3, FR-153
    const before = await old.db.activities.get(old.build.id);
    expect(acts[1]).toMatchObject({
      id: old.build.id,
      start: before!.start,
      days: before!.days,
      dependsOn: [old.design.id],
    });
    await expectValidOutbox(fresh.db);
  });

  it("overwrite: deletes the account's plans and their activities first", async () => {
    const old = await oldDevice();
    const snap = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    const fresh = await freshAccount();
    const mine = await fresh.repo.createPlan('Already here');
    const act = await fresh.repo.createActivity(mine.id, 'Mine');

    await fresh.repo.restoreSnapshot(snap, 'overwrite');
    expect((await getPlans(fresh.db)).map((p) => p.name)).toEqual(['Launch']);
    expect((await fresh.db.activities.get(act.id))?.deletedAt).not.toBeNull();
  });

  it('a snapshot kept before the Plan module (no `plans`) still restores', async () => {
    const old = await oldDevice();
    const { plans, activities, ...legacy } = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    void plans;
    void activities;
    const fresh = await freshAccount();
    const counts = await fresh.repo.restoreSnapshot(legacy as RecoverySnapshot, 'append');
    expect(counts).toEqual({ lists: 0, todos: 0, notes: 0, plans: 0 });
  });
});

describe('recovery offer with plans', () => {
  it('counts the kept plans and the plans the account holds', async () => {
    const old = await oldDevice();
    const snap = (await takeSnapshot(old.db, 'ann@corp.test'))!;
    const fresh = await freshAccount();
    await fresh.repo.createPlan('Already here');
    await fresh.db.setMeta(RECOVERY_KEY, snap);
    const recovery = createRecovery({ db: fresh.db, repo: fresh.repo });
    await recovery.load();
    expect(recovery.getOffer()).toMatchObject({ plans: 1, accountPlans: 1 });
  });
});
