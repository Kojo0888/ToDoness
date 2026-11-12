/** Plans and activities through the sync API (docs/plan/PRD.md FR-142, FR-143). */
import { beforeEach, describe, expect, it } from 'vitest';
import { newId, pullResponseSchema } from '@todoness/shared';
import { testApp } from './helpers/app';
import { hlcAt, loginDevice, op, registerDevice } from './helpers/sync';

type Ctx = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const t = testApp();
  const ann = await registerDevice(t.app, 'ann@corp.test', 'aaaa');
  const bob = await registerDevice(t.app, 'bob@corp.test', 'bbbb');
  const planId = newId();
  const designId = newId();
  const buildId = newId();
  const r = await ann.device.push([
    op('plan', 'create', planId, { name: 'Launch', orderKey: 'a0' }, hlcAt(1)),
    op(
      'activity',
      'create',
      designId,
      { planId, name: 'Design', start: '2026-03-02', days: 3, orderKey: 'a0' },
      hlcAt(2),
    ),
    op(
      'activity',
      'create',
      buildId,
      { planId, name: 'Build', start: '2026-03-05', orderKey: 'a1', dependsOn: [designId] },
      hlcAt(3),
    ),
  ]);
  if (r.rejected.length > 0) throw new Error(JSON.stringify(r.rejected));
  return { ...t, ann, bob, planId, designId, buildId };
}

const row = (c: Ctx, table: 'plans' | 'activities', id: string) =>
  c.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
    Record<string, unknown> | undefined;

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

describe('plans through sync', () => {
  it('stores pushed plans and activities and sends them to the other device of the user', async () => {
    expect(row(c, 'plans', c.planId)).toMatchObject({
      user_id: c.ann.me.id,
      name: 'Launch',
      order_key: 'a0',
      deleted_at: null,
    });
    expect(row(c, 'activities', c.buildId)).toMatchObject({
      user_id: c.ann.me.id,
      plan_id: c.planId,
      name: 'Build',
      start_day: '2026-03-05',
      days: 1,
      depends_on: JSON.stringify([c.designId]),
    });

    const phone = await loginDevice(c.app, 'ann@corp.test', 'cccc');
    const changes = await phone.pullAll();
    expect(changes.filter((ch) => ch.entity === 'plan').map((ch) => ch.entityId)).toEqual([
      c.planId,
    ]);
    const acts = changes.filter((ch) => ch.entity === 'activity');
    expect(acts.map((a) => a.entityId)).toEqual([c.designId, c.buildId]);
    expect(acts[0]!.patch).toMatchObject({ planId: c.planId, start: '2026-03-02', days: 3 });
    expect(acts[1]!.patch).toMatchObject({ dependsOn: [c.designId] });
  });

  it('merges updates per field and handles delete and restore', async () => {
    const r = await c.ann.device.push([
      op('activity', 'update', c.designId, { start: '2026-03-10' }, hlcAt(10)),
      op('activity', 'update', c.designId, { start: '2026-03-01', days: 7 }, hlcAt(5)),
      op('activity', 'update', c.buildId, { dependsOn: [] }, hlcAt(11)),
      op('activity', 'delete', c.buildId, {}, hlcAt(12)),
      op('plan', 'update', c.planId, { name: 'Launch 2' }, hlcAt(13)),
    ]);
    expect(r.rejected).toEqual([]);
    expect(row(c, 'activities', c.designId)).toMatchObject({ start_day: '2026-03-10', days: 7 });
    expect(row(c, 'activities', c.buildId)).toMatchObject({ depends_on: '[]' });
    expect(row(c, 'activities', c.buildId)!.deleted_at).not.toBeNull();
    expect(row(c, 'plans', c.planId)).toMatchObject({ name: 'Launch 2' });

    await c.ann.device.push([op('activity', 'restore', c.buildId, {}, hlcAt(14))]);
    expect(row(c, 'activities', c.buildId)!.deleted_at).toBeNull();
    await c.ann.device.push([op('plan', 'delete', c.planId, {}, hlcAt(15))]);
    expect(row(c, 'plans', c.planId)!.deleted_at).not.toBeNull();
  });

  it("refuses another user's plans and activities", async () => {
    const mine = newId();
    const r = await c.bob.device.push([
      op('plan', 'update', c.planId, { name: 'mine now' }, hlcAt(20, 'bbbb')),
      op('plan', 'create', c.planId, { name: 'x', orderKey: 'a0' }, hlcAt(21, 'bbbb')),
      op('activity', 'update', c.designId, { name: 'mine now' }, hlcAt(22, 'bbbb')),
      op('activity', 'delete', c.designId, {}, hlcAt(23, 'bbbb')),
      op(
        'activity',
        'create',
        mine,
        { planId: c.planId, name: 'Sneak', start: '2026-03-02', orderKey: 'a0' },
        hlcAt(24, 'bbbb'),
      ),
    ]);
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      'not_found',
      'not_found',
      'not_found',
      'not_found',
      'plan_not_found',
    ]);
    expect(row(c, 'plans', c.planId)).toMatchObject({ name: 'Launch' });
    expect(row(c, 'activities', mine)).toBeUndefined();
  });

  it('refuses an activity for an unknown plan, a move to a foreign plan, and invalid operations', async () => {
    const bobPlan = newId();
    await c.bob.device.push([
      op('plan', 'create', bobPlan, { name: 'Bob', orderKey: 'a0' }, hlcAt(30, 'bbbb')),
    ]);
    const r = await c.ann.device.push([
      op(
        'activity',
        'create',
        newId(),
        { planId: newId(), name: 'Lost', start: '2026-03-02', orderKey: 'a0' },
        hlcAt(31),
      ),
      op('activity', 'update', c.designId, { planId: bobPlan }, hlcAt(32)),
      op('activity', 'update', c.designId, { start: '2026-02-30' }, hlcAt(33)),
      op('activity', 'update', c.designId, { days: 0 }, hlcAt(34)),
      op('activity', 'update', newId(), { name: 'x' }, hlcAt(35)),
    ]);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      'plan_not_found',
      'plan_not_found',
      'invalid_operation',
      'invalid_operation',
      'not_found',
    ]);
  });

  it('does not let plans in through the public list and public note pushes', async () => {
    const listId = newId();
    const noteId = newId();
    await c.ann.device.push([
      op('list', 'create', listId, { name: 'Open', orderKey: 'b0', isPublic: true }, hlcAt(40)),
      op('note', 'create', noteId, { orderKey: 'a0', text: 'x', isPublic: true }, hlcAt(41)),
    ]);
    const ops = [
      op('plan', 'update', c.planId, { name: 'hacked' }, hlcAt(42, 'bbbb')),
      op('activity', 'update', c.designId, { name: 'hacked' }, hlcAt(43, 'bbbb')),
    ];
    for (const url of [`/api/public/lists/${listId}/push`, `/api/public/notes/${noteId}/push`]) {
      const res = await c.bob.device.http.post(url, { clientId: 'bbbb', ops });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { accepted: string[]; rejected: { reason: string }[] };
      expect(body.accepted).toEqual([]);
      expect(body.rejected.map((x) => x.reason)).toEqual(['forbidden', 'forbidden']);
    }
    expect(row(c, 'plans', c.planId)).toMatchObject({ name: 'Launch' });
  });

  it('removes plans and activities with their user', () => {
    c.db.prepare('DELETE FROM users WHERE id = ?').run(c.ann.me.id);
    expect(row(c, 'plans', c.planId)).toBeUndefined();
    expect(row(c, 'activities', c.designId)).toBeUndefined();
  });
});

describe('pull for apps from before the Plan module (FR-143)', () => {
  /** What such an app sends: no `plans=1`. */
  const legacyPull = async (since = 0, limit = 1000) => {
    const res = await c.ann.device.http.get(
      `/api/sync/pull?since=${since}&limit=${limit}&reminders=list`,
    );
    expect(res.status).toBe(200);
    return pullResponseSchema.parse(await res.json());
  };

  it('leaves plans and activities out, and still moves the cursor past them', async () => {
    const listId = newId();
    await c.ann.device.push([
      op('list', 'create', listId, { name: 'After', orderKey: 'b0' }, hlcAt(50)),
    ]);
    const full = await c.ann.device.pull(0, 1000);
    const old = await legacyPull();

    expect(old.changes.some((ch) => ch.entity === 'plan' || ch.entity === 'activity')).toBe(false);
    expect(old.changes.map((ch) => ch.entityId)).toContain(listId);
    expect(old.nextSeq).toBe(full.nextSeq);
    expect(old.hasMore).toBe(false);
  });

  it('a page that holds only plan changes is empty but not the end', async () => {
    const full = await c.ann.device.pull(0, 1000);
    const firstPlanSeq = full.changes.find((ch) => ch.entity === 'plan')!.serverSeq;
    const page = await legacyPull(firstPlanSeq - 1, 2);
    expect(page.changes).toEqual([]);
    expect(page.nextSeq).toBe(firstPlanSeq + 1);
    expect(page.hasMore).toBe(true);
  });
});

describe('done activities (docs/plan/PRD.md FR-153, FR-159)', () => {
  it('stores done, and sends it to apps that ask with activities=done', async () => {
    const r = await c.ann.device.push([
      op('activity', 'update', c.designId, { done: true }, hlcAt(10)),
    ]);
    expect(r.rejected).toEqual([]);
    expect(row(c, 'activities', c.designId)).toMatchObject({ done: 1 });
    expect(row(c, 'activities', c.buildId)).toMatchObject({ done: 0 });
    const changes = await c.ann.device.pullAll();
    expect(changes.at(-1)).toMatchObject({ entityId: c.designId, patch: { done: true } });
  });

  it('a create with done keeps it', async () => {
    const id = newId();
    await c.ann.device.push([
      op(
        'activity',
        'create',
        id,
        { planId: c.planId, name: 'Old', start: '2026-03-01', orderKey: 'a2', done: true },
        hlcAt(11),
      ),
    ]);
    expect(row(c, 'activities', id)).toMatchObject({ done: 1 });
  });

  it('leaves done out for apps that do not ask for it (they would refuse the field)', async () => {
    await c.ann.device.push([op('activity', 'update', c.designId, { done: true }, hlcAt(10))]);
    const res = await c.ann.device.http.get(
      '/api/sync/pull?since=0&limit=1000&reminders=list&lists=modules&plans=1',
    );
    const body = (await res.json()) as { changes: { entity: string; patch: object }[] };
    const activities = body.changes.filter((ch) => ch.entity === 'activity');
    expect(activities.length).toBe(3);
    expect(activities.some((ch) => 'done' in ch.patch)).toBe(false);
    expect(activities.at(-1)!.patch).toEqual({});
  });
});

describe('activity groups (docs/plan/PRD.md FR-174, FR-188)', () => {
  it('stores parentId and sends it to apps that ask with activities=done,groups', async () => {
    const r = await c.ann.device.push([
      op('activity', 'update', c.buildId, { parentId: c.designId }, hlcAt(10)),
    ]);
    expect(r.rejected).toEqual([]);
    expect(row(c, 'activities', c.buildId)).toMatchObject({ parent_id: c.designId });
    expect(row(c, 'activities', c.designId)).toMatchObject({ parent_id: null });
    const changes = await c.ann.device.pullAll();
    expect(changes.at(-1)).toMatchObject({ entityId: c.buildId, patch: { parentId: c.designId } });
  });

  it('a create with a parent keeps it; null clears it', async () => {
    const id = newId();
    await c.ann.device.push([
      op(
        'activity',
        'create',
        id,
        { planId: c.planId, name: 'Child', start: '2026-03-01', orderKey: 'a2', parentId: c.designId },
        hlcAt(11),
      ),
    ]);
    expect(row(c, 'activities', id)).toMatchObject({ parent_id: c.designId });
    await c.ann.device.push([op('activity', 'update', id, { parentId: null }, hlcAt(12))]);
    expect(row(c, 'activities', id)).toMatchObject({ parent_id: null });
  });

  it('leaves parentId out for apps that do not ask for groups (they would refuse the field)', async () => {
    await c.ann.device.push([
      op('activity', 'update', c.buildId, { parentId: c.designId, done: true }, hlcAt(10)),
    ]);
    const res = await c.ann.device.http.get(
      '/api/sync/pull?since=0&limit=1000&reminders=list&lists=modules&plans=1&activities=done',
    );
    const body = (await res.json()) as { changes: { entity: string; patch: object }[] };
    const activities = body.changes.filter((ch) => ch.entity === 'activity');
    expect(activities.some((ch) => 'parentId' in ch.patch)).toBe(false);
    expect(activities.at(-1)!.patch).toEqual({ done: true });
    // The current app gets both.
    const now = await c.ann.device.http.get(
      '/api/sync/pull?since=0&limit=1000&reminders=list&lists=modules&plans=1&activities=done,groups',
    );
    const all = (await now.json()) as { changes: { entity: string; patch: object }[] };
    expect(all.changes.at(-1)!.patch).toEqual({ parentId: c.designId, done: true });
  });
});
