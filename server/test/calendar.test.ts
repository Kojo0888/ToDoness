/** Calendars and events through the sync API (docs/calendar/PRD.md FR-216 – FR-218). */
import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@todoness/shared';
import { testApp } from './helpers/app';
import { hlcAt, loginDevice, op, registerDevice } from './helpers/sync';

type Ctx = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const t = testApp();
  const ann = await registerDevice(t.app, 'ann@corp.test', 'aaaa');
  const bob = await registerDevice(t.app, 'bob@corp.test', 'bbbb');
  const calendarId = newId();
  const eventId = newId();
  const r = await ann.device.push([
    op(
      'calendar',
      'create',
      calendarId,
      { name: 'Work', color: 'green', orderKey: 'a0' },
      hlcAt(1),
    ),
    op(
      'event',
      'create',
      eventId,
      {
        calendarId,
        title: 'Sprint review',
        start: '2026-11-17',
        startTime: '14:00',
        endTime: '15:00',
        place: 'Room 4',
      },
      hlcAt(2),
    ),
  ]);
  if (r.rejected.length > 0) throw new Error(JSON.stringify(r.rejected));
  return { ...t, ann, bob, calendarId, eventId };
}

const row = (c: Ctx, table: 'calendars' | 'events', id: string) =>
  c.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
    Record<string, unknown> | undefined;

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

describe('calendars through sync', () => {
  it('stores pushed calendars and events and sends them to the other device of the user', async () => {
    expect(row(c, 'calendars', c.calendarId)).toMatchObject({
      user_id: c.ann.me.id,
      name: 'Work',
      color: 'green',
      deleted_at: null,
    });
    expect(row(c, 'events', c.eventId)).toMatchObject({
      calendar_id: c.calendarId,
      title: 'Sprint review',
      start_day: '2026-11-17',
      days: 1,
      start_time: '14:00',
      end_time: '15:00',
      place: 'Room 4',
    });

    const phone = await loginDevice(c.app, 'ann@corp.test', 'cccc');
    const changes = await phone.pullAll();
    expect(changes.filter((ch) => ch.entity === 'calendar').map((ch) => ch.entityId)).toEqual([
      c.calendarId,
    ]);
    const events = changes.filter((ch) => ch.entity === 'event');
    expect(events[0]!.patch).toMatchObject({ calendarId: c.calendarId, title: 'Sprint review' });
  });

  it('merges per field and soft-deletes', async () => {
    await c.ann.device.push([
      op('event', 'update', c.eventId, { title: 'Newer' }, hlcAt(9)),
      op('event', 'update', c.eventId, { title: 'Older', place: 'Roof' }, hlcAt(5)),
    ]);
    expect(row(c, 'events', c.eventId)).toMatchObject({ title: 'Newer', place: 'Roof' });
    await c.ann.device.push([op('calendar', 'delete', c.calendarId, {}, hlcAt(12))]);
    expect(row(c, 'calendars', c.calendarId)!.deleted_at).not.toBeNull();
  });

  it('refuses an event for a calendar of somebody else or one that does not exist', async () => {
    const stranger = await c.bob.device.push([
      op(
        'event',
        'create',
        newId(),
        { calendarId: c.calendarId, title: 'Sneaky', start: '2026-11-17' },
        hlcAt(3),
      ),
    ]);
    expect(stranger.rejected.map((r) => r.reason)).toEqual(['calendar_not_found']);
    const ghost = await c.ann.device.push([
      op(
        'event',
        'create',
        newId(),
        { calendarId: newId(), title: 'Ghost', start: '2026-11-17' },
        hlcAt(3),
      ),
    ]);
    expect(ghost.rejected.map((r) => r.reason)).toEqual(['calendar_not_found']);
  });

  it("does not let another user change or see somebody's calendar", async () => {
    const r = await c.bob.device.push([
      op('calendar', 'update', c.calendarId, { name: 'Mine now' }, hlcAt(20)),
    ]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['not_found']);
    expect(row(c, 'calendars', c.calendarId)!.name).toBe('Work');
    const bobChanges = await c.bob.device.pullAll();
    expect(bobChanges.filter((ch) => ch.entity === 'calendar' || ch.entity === 'event')).toEqual(
      [],
    );
  });

  it('rejects invalid data (bad time, bad colour)', async () => {
    const r = await c.ann.device.push([
      op('event', 'update', c.eventId, { startTime: '25:00' }, hlcAt(30)),
      op('calendar', 'update', c.calendarId, { color: 'pink' }, hlcAt(31)),
    ]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['invalid_operation', 'invalid_operation']);
  });

  it('leaves calendars and events out for apps that do not ask for them (FR-217)', async () => {
    const res = await c.ann.device.http.get(
      '/api/sync/pull?since=0&reminders=list&lists=modules&plans=1&activities=done,groups',
    );
    const body = (await res.json()) as { changes: { entity: string }[]; nextSeq: number };
    expect(body.changes.filter((x) => x.entity === 'calendar' || x.entity === 'event')).toEqual([]);
    expect(body.nextSeq).toBeGreaterThanOrEqual(2); // the cursor still moves past them
  });

  it('is refused through the restricted public push (FR-218)', async () => {
    const listId = newId();
    const noteId = newId();
    await c.ann.device.push([
      op('list', 'create', listId, { name: 'Open', orderKey: 'b0', isPublic: true }, hlcAt(40)),
      op('note', 'create', noteId, { orderKey: 'a0', text: 'x', isPublic: true }, hlcAt(41)),
    ]);
    const ops = [
      op('calendar', 'update', c.calendarId, { name: 'hacked' }, hlcAt(42, 'bbbb')),
      op('event', 'update', c.eventId, { title: 'hacked' }, hlcAt(43, 'bbbb')),
    ];
    for (const url of [`/api/public/lists/${listId}/push`, `/api/public/notes/${noteId}/push`]) {
      const res = await c.bob.device.http.post(url, { clientId: 'bbbb', ops });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { accepted: string[]; rejected: { reason: string }[] };
      expect(body.accepted).toEqual([]);
      expect(body.rejected.map((x) => x.reason)).toEqual(['forbidden', 'forbidden']);
    }
  });
});
