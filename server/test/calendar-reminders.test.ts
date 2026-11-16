/** Repeating events and event reminders on the server (docs/calendar/PRD.md section 6). */
import { describe, expect, it } from 'vitest';
import { newId } from '@todoness/shared';
import { sweepReminders, type PushPayload, type PushSend } from '../src/push/reminders';
import { testApp } from './helpers/app';
import { hlcAt, op, registerDevice, type Device } from './helpers/sync';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** 14:00 on 2026-11-18 in Warsaw (winter time, UTC+1). */
const START = Date.UTC(2026, 10, 18, 13, 0);

const SUB = {
  endpoint: 'https://push.example/device-1',
  expirationTime: null,
  keys: { p256dh: 'p', auth: 'a' },
};

async function setup() {
  const t = testApp();
  const ann = await registerDevice(t.app, 'ann@corp.test', 'aaaa');
  const calendarId = newId();
  const sent: { endpoint: string; payload: PushPayload }[] = [];
  const ntfy: { topic: string; payload: PushPayload }[] = [];
  const send: PushSend = async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, payload });
    return 'ok';
  };
  let n = 10;
  await ann.device.push([
    op('calendar', 'create', calendarId, { name: 'Work', orderKey: 'a0' }, hlcAt(1)),
  ]);
  const mk = async (patch: Record<string, unknown> = {}, d: Device = ann.device) => {
    const id = newId();
    const r = await d.push([
      op(
        'event',
        'create',
        id,
        {
          calendarId,
          title: 'Sprint review',
          start: '2026-11-18',
          startTime: '14:00',
          endTime: '15:00',
          tz: 'Europe/Warsaw',
          reminders: ['hour'],
          ...patch,
        },
        hlcAt(n++),
      ),
    ]);
    if (r.rejected.length > 0) throw new Error(JSON.stringify(r.rejected));
    return id;
  };
  const subscribe = () => ann.device.http.post('/api/push/subscribe', SUB);
  const sweep = (now: number) => sweepReminders({ db: t.db, send, now });
  const sweepNtfy = (now: number) =>
    sweepReminders({
      db: t.db,
      send,
      sendNtfy: async (topic, payload) => {
        ntfy.push({ topic, payload });
        return 'ok';
      },
      now,
    });
  const update = (id: string, patch: Record<string, unknown>) =>
    ann.device.push([op('event', 'update', id, patch, hlcAt(n++))]);
  return { ...t, ann, calendarId, sent, ntfy, mk, subscribe, sweep, sweepNtfy, update };
}

describe('event reminder sweep (FR-225 – FR-228)', () => {
  it('pushes once, with title, text, tag and link, when the time has come', async () => {
    const s = await setup();
    const id = await s.mk();
    await s.subscribe();
    expect((await s.sweep(START - 2 * HOUR)).sent).toBe(0); // too early
    expect((await s.sweep(START - 30 * MIN)).sent).toBe(1);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.payload).toEqual({
      title: 'Sprint review',
      body: 'Starts in 30 minutes (14:00)',
      tag: `event:${id}:2026-11-18:hour`,
      url: `/calendar/e/${id}`,
    });
    expect((await s.sweep(START - 20 * MIN)).sent).toBe(0); // never twice
    expect(s.sent).toHaveLength(1);
  });

  it('of several chosen reminders only the latest passed one is sent (FR-226)', async () => {
    const s = await setup();
    const id = await s.mk({ reminders: ['day', 'hour', 'start'] });
    await s.subscribe();
    expect((await s.sweep(START - 30 * MIN)).sent).toBe(1);
    expect(s.sent[0]!.payload.tag).toBe(`event:${id}:2026-11-18:hour`);
    expect((await s.sweep(START + 1000)).sent).toBe(1);
    expect(s.sent[1]!.payload.tag).toBe(`event:${id}:2026-11-18:start`);
    expect(s.sent[1]!.payload.body).toBe('Starting now (14:00)');
  });

  it('a reminder is skipped once 10 minutes have passed since the start', async () => {
    const s = await setup();
    await s.mk({ reminders: ['start'] });
    await s.subscribe();
    expect((await s.sweep(START + 11 * MIN)).sent).toBe(0);
  });

  it('an all-day event is reminded at 09:00 local time; the text says the day', async () => {
    const s = await setup();
    const id = await s.mk({ startTime: null, endTime: null, reminders: ['start', 'day'] });
    await s.subscribe();
    const nineWarsaw = Date.UTC(2026, 10, 18, 8, 0);
    expect((await s.sweep(nineWarsaw - 2 * HOUR)).sent).toBe(1); // 09:00 the day before is "1 day"
    expect(s.sent[0]!.payload).toMatchObject({
      tag: `event:${id}:2026-11-18:day`,
      body: 'All day on 2026-11-18',
    });
    expect((await s.sweep(nineWarsaw + MIN)).sent).toBe(1);
    expect(s.sent[1]!.payload.tag).toBe(`event:${id}:2026-11-18:start`);
  });

  it('a weekly event is reminded for every occurrence, once each', async () => {
    const s = await setup();
    const id = await s.mk({ repeat: 'weekly' });
    await s.subscribe();
    expect((await s.sweep(START - 30 * MIN)).sent).toBe(1);
    expect((await s.sweep(START + 7 * DAY - 30 * MIN)).sent).toBe(1);
    expect(s.sent.map((x) => x.payload.tag)).toEqual([
      `event:${id}:2026-11-18:hour`,
      `event:${id}:2026-11-25:hour`,
    ]);
    expect((await s.sweep(START + 7 * DAY - 25 * MIN)).sent).toBe(0);
    expect((await s.sweep(START + 3 * DAY)).sent).toBe(0); // nothing between occurrences
  });

  it('a series is not reminded after its end day', async () => {
    const s = await setup();
    await s.mk({ repeat: 'weekly', repeatUntil: '2026-11-20' });
    await s.subscribe();
    expect((await s.sweep(START + 7 * DAY - 30 * MIN)).sent).toBe(0);
  });

  it('daylight saving: the same wall-clock time after the change is a different moment', async () => {
    const s = await setup();
    // Daily from the last winter day; 2026-03-29 is the first summer day in Warsaw.
    await s.mk({ start: '2026-03-28', repeat: 'daily', reminders: ['start'] });
    await s.subscribe();
    const summer = Date.UTC(2026, 2, 29, 12, 0); // 14:00 CEST
    expect((await s.sweep(summer + MIN)).sent).toBe(1);
  });

  it('moving an event to another time re-arms its reminder', async () => {
    const s = await setup();
    const id = await s.mk();
    await s.subscribe();
    await s.sweep(START - 30 * MIN);
    await s.update(id, { startTime: '16:00', endTime: '17:00' });
    expect((await s.sweep(START + 2 * HOUR - 30 * MIN)).sent).toBe(1);
  });

  it('nothing is sent for events without reminders, deleted events or deleted calendars', async () => {
    const s = await setup();
    await s.mk({ reminders: [] });
    const gone = await s.mk();
    await s.ann.device.push([op('event', 'delete', gone, {}, hlcAt(90))]);
    const other = newId();
    await s.ann.device.push([
      op('calendar', 'create', other, { name: 'Old', orderKey: 'a5' }, hlcAt(91)),
    ]);
    await s.mk({ calendarId: other });
    await s.ann.device.push([op('calendar', 'delete', other, {}, hlcAt(92))]);
    await s.subscribe();
    expect((await s.sweep(START - 30 * MIN)).sent).toBe(0);
  });

  it('is not used up while nobody could receive it; ntfy counts as a receiver', async () => {
    const s = await setup();
    await s.mk();
    expect((await s.sweep(START - 30 * MIN)).sent).toBe(0); // no device
    await s.subscribe();
    expect((await s.sweep(START - 29 * MIN)).sent).toBe(1);

    const t = await setup();
    await t.mk();
    t.db
      .prepare('INSERT INTO ntfy_topics (user_id, topic, created_at) VALUES (?, ?, ?)')
      .run(t.ann.me.id, 'todoness-ann-topic-1234', 1);
    const r = await t.sweepNtfy(START - 30 * MIN);
    expect(r.sent).toBe(1);
    expect(t.ntfy.map((x) => x.topic)).toEqual(['todoness-ann-topic-1234']);
    expect(t.ntfy[0]!.payload.title).toBe('Sprint review');
  });

  it('forgets old reminders and deletes them with the event', async () => {
    const s = await setup();
    const id = await s.mk();
    await s.subscribe();
    await s.sweep(START - 30 * MIN);
    const count = () =>
      (s.db.prepare('SELECT COUNT(*) n FROM sent_event_reminders').get() as { n: number }).n;
    expect(count()).toBe(1);
    await s.sweep(START + 61 * DAY);
    expect(count()).toBe(0);
    await s.sweep(START - 30 * MIN); // recorded again, as a fresh run
    s.db.pragma('foreign_keys = ON');
    s.db.prepare('DELETE FROM events WHERE id = ?').run(id);
    expect(count()).toBe(0);
  });
});

describe('new event fields through sync (FR-230, FR-231)', () => {
  it('are stored and sent to the other device', async () => {
    const s = await setup();
    const id = await s.mk({
      repeat: 'monthly',
      repeatUntil: '2027-01-31',
      reminders: ['day', 'start'],
    });
    expect(s.db.prepare('SELECT * FROM events WHERE id = ?').get(id)).toMatchObject({
      repeat: 'monthly',
      repeat_until: '2027-01-31',
      reminders: 'day,start',
      tz: 'Europe/Warsaw',
    });
    const changes = await s.ann.device.pullAll();
    expect(changes.find((c) => c.entityId === id)!.patch).toMatchObject({
      repeat: 'monthly',
      repeatUntil: '2027-01-31',
      reminders: ['day', 'start'],
      tz: 'Europe/Warsaw',
    });
  });

  it('are left out for apps that do not ask for them; an update of only those becomes empty', async () => {
    const s = await setup();
    const id = await s.mk({ repeat: 'weekly' });
    await s.update(id, { reminders: ['day'] });
    const res = await s.ann.device.http.get(
      '/api/sync/pull?since=0&reminders=list&lists=modules&plans=1&activities=done,groups&calendar=1',
    );
    const body = (await res.json()) as {
      changes: { entityId: string; entity: string; patch: Record<string, unknown> }[];
    };
    const mine = body.changes.filter((c) => c.entityId === id);
    expect(mine).toHaveLength(2);
    for (const c of mine) {
      for (const k of ['repeat', 'repeatUntil', 'reminders', 'tz'])
        expect(c.patch).not.toHaveProperty(k);
    }
    expect(mine[0]!.patch).toMatchObject({ title: 'Sprint review' });
    expect(mine[1]!.patch).toEqual({});
  });
});
