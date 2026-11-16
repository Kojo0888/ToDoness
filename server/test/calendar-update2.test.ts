/** Calendar Update 2 on the server (docs/calendar/PRD.md section 7). */
import { describe, expect, it } from 'vitest';
import { newId } from '@todoness/shared';
import { testApp } from './helpers/app';
import { hlcAt, op, registerDevice } from './helpers/sync';

const pullWith = (d: Awaited<ReturnType<typeof registerDevice>>['device'], query: string) =>
  d.http.get(`/api/sync/pull?since=0&limit=1000&${query}`).then((r) => r.json());

describe('"My calendar" (FR-244)', () => {
  it('is created at sign-up, once, and reaches the device', async () => {
    const t = testApp();
    const ann = await registerDevice(t.app, 'ann@corp.test', 'aaaa');
    const calendars = (await ann.device.pullAll()).filter((c) => c.entity === 'calendar');
    expect(calendars).toHaveLength(1);
    expect(calendars[0]!.patch).toMatchObject({ name: 'My calendar', color: 'blue' });
    // Pulling again does not add another one.
    await ann.device.pullAll();
    const n = t.db.prepare('SELECT COUNT(*) AS n FROM calendars').get() as { n: number };
    expect(n.n).toBe(1);
  });

  it('is created at the next sync for an account that never had a calendar', async () => {
    const t = testApp();
    const ann = await registerDevice(t.app, 'ann@corp.test', 'aaaa');
    t.db.prepare('DELETE FROM calendars').run();
    const calendars = (await ann.device.pullAll()).filter((c) => c.entity === 'calendar');
    expect(calendars.some((c) => c.patch.name === 'My calendar')).toBe(true);
  });

  it('is not created again after the user deleted it', async () => {
    const t = testApp();
    const ann = await registerDevice(t.app, 'ann@corp.test', 'aaaa');
    const id = (await ann.device.pullAll()).find((c) => c.entity === 'calendar')!.entityId;
    await ann.device.push([op('calendar', 'delete', id, {}, hlcAt(50))]);
    await ann.device.pullAll();
    const n = t.db.prepare('SELECT COUNT(*) AS n FROM calendars').get() as { n: number };
    expect(n.n).toBe(1);
  });
});

describe('new fields and older apps (FR-248)', () => {
  it('syncs isPublic and description, and strips them for apps that do not ask', async () => {
    const t = testApp();
    const ann = await registerDevice(t.app, 'ann@corp.test', 'aaaa');
    const cal = newId();
    const ev = newId();
    await ann.device.push([
      op('calendar', 'create', cal, { name: 'Team', orderKey: 'a5', isPublic: true }, hlcAt(1)),
      op(
        'event',
        'create',
        ev,
        { calendarId: cal, title: 'Sync', start: '2026-11-18', description: 'Agenda: 1. news' },
        hlcAt(2),
      ),
    ]);
    const all = (await ann.device.pullAll()).filter((c) => c.entityId === cal || c.entityId === ev);
    expect(all.find((c) => c.entityId === cal)!.patch).toMatchObject({ isPublic: true });
    expect(all.find((c) => c.entityId === ev)!.patch).toMatchObject({
      description: 'Agenda: 1. news',
    });

    const old = (await pullWith(ann.device, 'calendar=1&events=repeat')) as {
      changes: { entityId: string; patch: Record<string, unknown> }[];
    };
    for (const c of old.changes.filter((c) => c.entityId === cal || c.entityId === ev)) {
      expect(c.patch).not.toHaveProperty('isPublic');
      expect(c.patch).not.toHaveProperty('description');
    }
  });
});

describe('public calendars (FR-241, FR-242)', () => {
  it('lists the public calendars of others with their events, read-only', async () => {
    const t = testApp();
    const ann = await registerDevice(t.app, 'ann@corp.test', 'aaaa');
    const bob = await registerDevice(t.app, 'bob@corp.test', 'bbbb');
    const pub = newId();
    const priv = newId();
    const gone = newId();
    await ann.device.push([
      op('calendar', 'create', pub, { name: 'Team', orderKey: 'a5', isPublic: true }, hlcAt(1)),
      op('calendar', 'create', priv, { name: 'Mine', orderKey: 'a6' }, hlcAt(2)),
      op('calendar', 'create', gone, { name: 'Gone', orderKey: 'a7', isPublic: true }, hlcAt(3)),
      op('calendar', 'delete', gone, {}, hlcAt(4)),
      op(
        'event',
        'create',
        newId(),
        { calendarId: pub, title: 'Launch', start: '2026-11-18', description: 'Cake' },
        hlcAt(5),
      ),
      op(
        'event',
        'create',
        newId(),
        { calendarId: priv, title: 'Secret', start: '2026-11-18' },
        hlcAt(6),
      ),
    ]);

    const res = await bob.device.http.get('/api/public/calendars');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      calendars: {
        id: string;
        name: string;
        ownerEmail: string;
        events: { title: string; description: string }[];
      }[];
    };
    expect(body.calendars).toHaveLength(1);
    expect(body.calendars[0]).toMatchObject({ id: pub, name: 'Team', ownerEmail: 'ann@corp.test' });
    expect(body.calendars[0]!.events).toEqual([
      expect.objectContaining({ title: 'Launch', description: 'Cake' }),
    ]);

    // The owner does not see their own calendar in the public list.
    const own = (await (await ann.device.http.get('/api/public/calendars')).json()) as {
      calendars: unknown[];
    };
    expect(own.calendars).toHaveLength(0);
  });

  it('needs a login', async () => {
    const t = testApp();
    const res = await t.app.request('/api/public/calendars');
    expect(res.status).toBe(401);
  });
});
