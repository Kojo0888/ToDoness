/** Activity groups in the local database (docs/plan/PRD.md section 11). */
import { describe, expect, it } from 'vitest';
import { addDays, formatHlc, localDay, planTree, spansOf } from '@todoness/shared';
import { diffActivities } from '../../src/lib/planUndo';
import { RepoError } from '../../src/data/repo';
import { getActivities } from '../../src/data/queries';
import { expectValidOutbox, fakeNow, T0, testRepo } from '../helpers/db';

const TODAY = localDay(T0);
const day = (offset: number) => addDays(TODAY, offset);

async function setup() {
  const now = fakeNow();
  const t = testRepo({ now });
  const plan = await t.repo.createPlan('Launch');
  const acts = async () => getActivities(t.db, plan.id);
  const byName = async (name: string) => (await acts()).find((a) => a.name === name)!;
  /** Names in the timeline's row order (a group, then its children), with the parent: `Pages<Front`. */
  const rows = async () => {
    const all = await acts();
    const tree = planTree(all);
    const name = (id: string) => all.find((a) => a.id === id)!.name;
    const out: string[] = [];
    const walk = (id: string) => {
      const p = tree.parent.get(id);
      out.push(p ? `${name(id)}<${name(p)}` : name(id));
      for (const k of tree.children.get(id) ?? []) walk(k);
    };
    for (const a of all) if (!tree.parent.has(a.id)) walk(a.id);
    return out;
  };
  const add = async (name: string, offset: number, days: number) => {
    now.advance(10);
    const a = await t.repo.createActivity(plan.id, name);
    return t.repo.updateActivity(a.id, { start: day(offset), days });
  };
  const span = async (name: string) => spansOf(await acts()).get((await byName(name)).id);
  return { ...t, now, plan, acts, byName, rows, add, span };
}

describe('groups – repo (FR-174 – FR-178)', () => {
  it('dropping one activity on another makes a new group in the target’s place', async () => {
    const s = await setup();
    const a = await s.add('Pages', 0, 3);
    const b = await s.add('Forms', 2, 2);
    await s.add('Tests', 6, 1);
    const g = await s.repo.groupActivities(a.id, b.id);
    expect(g.name).toBe('Pages & Forms');
    expect(await s.rows()).toEqual([
      'Pages & Forms',
      'Pages<Pages & Forms',
      'Forms<Pages & Forms',
      'Tests',
    ]);
    // Its stored dates are its children's (FR-188).
    expect(g).toMatchObject({ start: day(0), days: 4 });
    expect(await s.span('Pages & Forms')).toEqual({ start: day(0), days: 4 });
    await expectValidOutbox(s.db);
  });

  it('adds an activity to a group as its last child, and takes it out again', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 1);
    const b = await s.add('B', 1, 1);
    const c = await s.add('C', 9, 1);
    const g = await s.repo.groupActivities(a.id, b.id);
    await s.repo.moveToGroup(c.id, g.id);
    expect(await s.rows()).toEqual(['A & B', 'A<A & B', 'B<A & B', 'C<A & B']);
    expect(await s.byName('A & B')).toMatchObject({ start: day(0), days: 10 });
    await s.repo.moveToGroup(c.id, null);
    expect(await s.rows()).toEqual(['A & B', 'A<A & B', 'B<A & B', 'C']);
    expect(await s.byName('A & B')).toMatchObject({ start: day(0), days: 2 });
  });

  it('removes a group that the change left empty (FR-178)', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 1);
    const b = await s.add('B', 1, 1);
    const g = await s.repo.groupActivities(a.id, b.id);
    await s.repo.moveToGroup(a.id, null);
    expect(await s.rows()).toEqual(['A & B', 'B<A & B', 'A']);
    await s.repo.moveToGroup(b.id, null);
    // Each one taken out lands right after its old group.
    expect(await s.rows()).toEqual(['B', 'A']);
    expect((await s.acts()).some((x) => x.id === g.id)).toBe(false);
  });

  it('nests groups, up to four levels', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 1);
    const b = await s.add('B', 1, 1);
    const c = await s.add('C', 2, 1);
    const d = await s.add('D', 3, 1);
    const e = await s.add('E', 4, 1);
    const g1 = await s.repo.groupActivities(a.id, b.id); // level 1: g1; A, B at 2
    const g2 = await s.repo.groupActivities(a.id, c.id); // g2 at 2; A, C at 3
    await s.repo.groupActivities(a.id, d.id); // g3 at 3; A, D at 4
    expect((await s.byName('A')).parentId).not.toBe(g1.id);
    await expect(s.repo.groupActivities(a.id, e.id)).rejects.toMatchObject({ code: 'depth' });
    // A group cannot go into itself.
    await expect(s.repo.moveToGroup(g1.id, g2.id)).rejects.toMatchObject({ code: 'loop' });
    await expect(s.repo.groupActivities(a.id, g1.id)).rejects.toBeInstanceOf(RepoError);
  });

  it('moving a group moves every activity in it; its duration cannot be set (FR-175, FR-182)', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 2);
    const b = await s.add('B', 3, 1);
    const g = await s.repo.groupActivities(a.id, b.id);
    await s.repo.updateActivity(g.id, { start: day(5) });
    expect(await s.byName('A')).toMatchObject({ start: day(5), days: 2 });
    expect(await s.byName('B')).toMatchObject({ start: day(8), days: 1 });
    expect(await s.byName('A & B')).toMatchObject({ start: day(5), days: 4 });
    await s.repo.updateActivity(g.id, { days: 30 });
    expect(await s.span('A & B')).toEqual({ start: day(5), days: 4 });
  });

  it('a group does not move before its predecessors allow; a link to it pushes its activities (FR-183)', async () => {
    const s = await setup();
    const x = await s.add('X', 0, 5);
    const a = await s.add('A', 6, 2);
    const b = await s.add('B', 9, 1);
    const g = await s.repo.groupActivities(a.id, b.id);
    await s.repo.linkActivities(x.id, g.id);
    await s.repo.updateActivity(x.id, { days: 8 }); // X now ends on day 7
    expect(await s.byName('A')).toMatchObject({ start: day(8) });
    expect(await s.byName('B')).toMatchObject({ start: day(9) });
    await s.repo.updateActivity(g.id, { start: day(0) });
    expect(await s.span('A & B')).toEqual({ start: day(8), days: 2 });
    await expect(s.repo.linkActivities(g.id, a.id)).rejects.toMatchObject({ code: 'loop' });
  });

  it('done cannot be set on a group: it follows its activities (FR-184)', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 1);
    const b = await s.add('B', 1, 1);
    const g = await s.repo.groupActivities(a.id, b.id);
    // refused loudly, so no caller believes it worked
    await expect(s.repo.updateActivity(g.id, { done: true })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(s.repo.updateActivity(g.id, (now) => ({ done: !now.done }))).rejects.toMatchObject(
      { code: 'invalid' },
    );
    expect((await s.acts()).some((x) => x.done)).toBe(false);
    // a rename still works, and the group is done once every activity is
    await s.repo.updateActivity(g.id, { name: 'Both' });
    expect((await s.acts()).find((x) => x.id === g.id)?.name).toBe('Both');
    expect((await s.acts()).some((x) => x.done)).toBe(false);
    await s.repo.updateActivity(a.id, { done: true });
    await s.repo.updateActivity(b.id, { done: true });
    expect((await s.acts()).filter((x) => x.parentId === g.id).every((x) => x.done)).toBe(true);
  });

  it('ungroup keeps the children in the group’s place; regroup undoes it (FR-186)', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 1);
    const b = await s.add('B', 1, 1);
    await s.add('C', 2, 1);
    const g = await s.repo.groupActivities(a.id, b.id);
    const children = await s.repo.ungroupActivity(g.id);
    expect(children.sort()).toEqual([a.id, b.id].sort());
    expect(await s.rows()).toEqual(['A', 'B', 'C']);
    await s.repo.regroupActivity(g.id, children);
    expect(await s.rows()).toEqual(['A & B', 'A<A & B', 'B<A & B', 'C']);
  });

  it('deleting a group deletes everything in it; restoring brings it all back (FR-186)', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 1);
    const b = await s.add('B', 1, 1);
    const c = await s.add('C', 2, 1);
    const g = await s.repo.groupActivities(a.id, b.id);
    await s.repo.moveToGroup(c.id, g.id);
    await s.repo.deleteActivity(c.id); // deleted earlier on its own: stays deleted
    s.now.advance(10);
    await s.repo.deleteActivity(g.id);
    expect(await s.rows()).toEqual([]);
    await s.repo.restoreActivity(g.id);
    expect(await s.rows()).toEqual(['A & B', 'A<A & B', 'B<A & B']);
  });
});

describe('groups – deleting (review of PR 25)', () => {
  it('deleting the last child removes the emptied group; restoring brings both back (FR-178)', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 1);
    const b = await s.add('B', 1, 1);
    await s.add('C', 5, 1);
    const g = await s.repo.groupActivities(a.id, b.id);
    await s.repo.deleteActivity(a.id);
    expect(await s.rows()).toEqual(['A & B', 'B<A & B', 'C']);
    await s.repo.deleteActivity(b.id);
    expect(await s.rows()).toEqual(['C']);
    expect((await s.db.activities.get(g.id))!.deletedAt).not.toBeNull();
    await s.repo.restoreActivity(b.id);
    expect(await s.rows()).toEqual(['A & B', 'B<A & B', 'C']);
  });

  it('restoring a group does not bring back a child another device deleted on its own', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 1);
    const b = await s.add('B', 1, 1);
    const c = await s.add('C', 2, 1);
    const g = await s.repo.groupActivities(a.id, b.id);
    await s.repo.moveToGroup(c.id, g.id);
    await s.repo.deleteActivity(g.id);
    // C's deletion as if it came from another device, even with a later clock.
    const row = (await s.db.activities.get(c.id))!;
    const other = formatHlc({ wall: s.now() + 60_000, counter: 0, clientId: 'other' });
    await s.db.activities.put({ ...row, fieldHlc: { ...row.fieldHlc, deletedAt: other } });
    await s.repo.restoreActivity(g.id);
    expect(await s.rows()).toEqual(['A & B', 'A<A & B', 'B<A & B']);
  });
});

describe('groups – undo (FR-187)', () => {
  it('records parentId changes and the group a change created', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 1);
    const b = await s.add('B', 1, 1);
    const before = await s.acts();
    const g = await s.repo.groupActivities(a.id, b.id);
    const did = diffActivities(before, await s.acts());
    expect(did.find((c) => c.id === a.id)).toMatchObject({
      before: { parentId: null },
      after: { parentId: g.id },
    });
    expect(did.find((c) => c.id === g.id)).toMatchObject({ created: true });
    await s.repo.revertActivities(did);
    expect(await s.rows()).toEqual(['A', 'B']);
  });

  it('restores a group the change removed', async () => {
    const s = await setup();
    const a = await s.add('A', 0, 1);
    const b = await s.add('B', 1, 1);
    const g = await s.repo.groupActivities(a.id, b.id);
    await s.repo.moveToGroup(a.id, null);
    const before = await s.acts();
    await s.repo.moveToGroup(b.id, null); // empties and removes the group
    const did = diffActivities(before, await s.acts());
    expect(did.find((c) => c.id === g.id)).toMatchObject({ deleted: true });
    await s.repo.revertActivities(did);
    expect(await s.rows()).toEqual(['A & B', 'B<A & B', 'A']);
  });

  it('a plain add or delete is not part of an undo point (FR-147 keeps its own Undo message)', async () => {
    const s = await setup();
    const before = await s.acts();
    await s.add('A', 0, 1);
    expect(diffActivities(before, await s.acts())).toEqual([]);
  });
});
