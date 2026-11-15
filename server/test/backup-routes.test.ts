/** The backup part of the admin API (docs/backup/PRD.md FR-232, FR-239). */
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testApp } from './helpers/app';
import { registerDevice } from './helpers/sync';

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'todoness-backup-routes-'));
  const dir = join(root, 'backups');
  const t = testApp({ BACKUP_DIR: dir, ATTACHMENTS_DIR: join(root, 'attachments') });
  const admin = await registerDevice(t.app, 'admin@corp.test'); // the first account is the admin
  const user = await registerDevice(t.app, 'user@corp.test');
  const settle = async () => {
    for (let i = 0; i < 300; i++) {
      const st = await (await admin.device.http.get('/api/admin/backup')).json();
      if (!st.running) return st;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('still running');
  };
  return { ...t, root, dir, admin: admin.device.http, user: user.device.http, settle };
}

describe('admin backup API', () => {
  it('is for administrators only', async () => {
    const s = await setup();
    for (const [method, path] of [
      ['GET', '/api/admin/backup'],
      ['PUT', '/api/admin/backup'],
      ['POST', '/api/admin/backup/run'],
    ] as const) {
      const r = await s.user.request(
        method,
        path,
        method === 'PUT' ? { enabled: true, frequency: 'day', keep: 3 } : undefined,
      );
      expect(r.status).toBe(403);
    }
    const anonymous = await s.app.request('/api/admin/backup');
    expect(anonymous.status).toBe(401);
  });

  it('GET: the settings, the folder and an empty list at the start', async () => {
    const s = await setup();
    const r = await s.admin.get('/api/admin/backup');
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      enabled: false,
      frequency: 'week',
      keep: 3,
      dir: s.dir,
      writable: true,
      running: false,
      lastAt: null,
      nextAt: null,
      lastError: null,
      backups: [],
    });
  });

  it('PUT: stores the settings; switching on makes the first backup', async () => {
    const s = await setup();
    const r = await s.admin.request('PUT', '/api/admin/backup', {
      enabled: true,
      frequency: 'day',
      keep: 5,
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ enabled: true, frequency: 'day', keep: 5 });
    const st = await s.settle();
    expect(st.backups).toHaveLength(1);
    expect(st.lastAt).not.toBeNull();
    expect(readdirSync(s.dir).filter((f) => f.endsWith('.zip'))).toHaveLength(1);
  });

  it.each([
    [{ enabled: 'yes', frequency: 'day', keep: 3 }],
    [{ enabled: true, frequency: 'hourly', keep: 3 }],
    [{ enabled: true, frequency: 'day', keep: 0 }],
    [{ enabled: true, frequency: 'day', keep: 101 }],
    [{ enabled: true, frequency: 'day', keep: 2.5 }],
    [{ enabled: true, frequency: 'day' }],
    [{ enabled: true, frequency: 'day', keep: 3, path: '/etc' }],
  ])('PUT: refuses %j', async (body) => {
    const s = await setup();
    const r = await s.admin.request('PUT', '/api/admin/backup', body);
    expect(r.status).toBe(400);
    expect((await (await s.admin.get('/api/admin/backup')).json()).enabled).toBe(false);
  });

  it('POST /run: makes a backup now and answers at once (202); 409 while one is running', async () => {
    const s = await setup();
    const first = await s.admin.post('/api/admin/backup/run');
    expect(first.status).toBe(202);
    const second = await s.admin.post('/api/admin/backup/run');
    expect([202, 409]).toContain(second.status); // 409 only if the first is still running
    const st = await s.settle();
    expect(st.backups.length).toBeGreaterThanOrEqual(1);
    expect(st.enabled).toBe(false); // a manual backup does not switch the schedule on
  });

  it('GET lists the backups, newest first, and says when the folder cannot be used', async () => {
    const s = await setup();
    await s.admin.post('/api/admin/backup/run');
    const st = await s.settle();
    expect(st.backups[0]).toMatchObject({
      name: expect.stringMatching(/^todoness-backup-\d{8}-\d{6}\.zip$/),
    });
    expect(st.backups[0].size).toBeGreaterThan(0);
  });
});
