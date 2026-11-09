/** Reordering notes by hand (docs/notes/PRD.md FR-100 – FR-102). */
import { describe, expect, it } from 'vitest';
import { newId } from '@todoness/shared';
import { getNotes } from '../../src/data/queries';
import { expectValidOutbox, fakeNow, testRepo } from '../helpers/db';

async function setup(texts: string[]) {
  const now = fakeNow();
  const t = testRepo({ now });
  const ids: Record<string, string> = {};
  for (const text of texts) {
    ids[text] = (await t.repo.createNote(text)).id;
    now.advance(10);
  }
  await t.db.outbox.clear();
  const order = async () => (await getNotes(t.db)).map((n) => n.text);
  return { ...t, ids, order };
}

describe('reorderNote', () => {
  it('moves a note to the top, into the middle and to the end', async () => {
    const s = await setup(['A', 'B', 'C', 'D']); // shown D C B A
    expect(await s.order()).toEqual(['D', 'C', 'B', 'A']);
    await s.repo.reorderNote(s.ids.A!, s.ids.D!);
    expect(await s.order()).toEqual(['A', 'D', 'C', 'B']);
    await s.repo.reorderNote(s.ids.A!, s.ids.B!);
    expect(await s.order()).toEqual(['D', 'C', 'A', 'B']);
    await s.repo.reorderNote(s.ids.D!, null);
    expect(await s.order()).toEqual(['C', 'A', 'B', 'D']);
    const ops = await expectValidOutbox(s.db);
    expect(ops).toHaveLength(3);
    expect(
      ops.every((o) => o.entity === 'note' && Object.keys(o.patch).join() === 'orderKey'),
    ).toBe(true);
  });

  it('does nothing when the note stays where it is', async () => {
    const s = await setup(['A', 'B', 'C']); // C B A
    await s.repo.reorderNote(s.ids.B!, s.ids.A!);
    await s.repo.reorderNote(s.ids.A!, null);
    await s.repo.reorderNote(s.ids.C!, s.ids.C!);
    expect(await s.order()).toEqual(['C', 'B', 'A']);
    expect(await s.db.outbox.count()).toBe(0);
  });

  it('skips deleted notes and refuses unknown ones', async () => {
    const s = await setup(['A', 'B', 'C']); // C B A
    await s.repo.deleteNote(s.ids.B!);
    await s.repo.reorderNote(s.ids.A!, s.ids.C!);
    expect(await s.order()).toEqual(['A', 'C']);
    await expect(s.repo.reorderNote(newId(), null)).rejects.toMatchObject({ code: 'not_found' });
    await expect(s.repo.reorderNote(s.ids.A!, s.ids.B!)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('works when two devices gave notes the same key', async () => {
    const s = await setup(['A']);
    // A note from another device with the same key as A.
    const a = (await s.db.notes.get(s.ids.A!))!;
    const twinId = newId();
    await s.db.notes.put({ ...a, id: twinId, text: 'Twin' });
    const c = await s.repo.createNote('C');
    await s.repo.reorderNote(c.id, null);
    const order = await s.order();
    expect(order.at(-1)).toBe('C');
    expect(order).toHaveLength(3);
  });
});
