/** The backup calls of the Admin screen (docs/backup/PRD.md). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBackup, runBackup, saveBackup } from '../../src/services/adminApi';
import { fakeFetch, json } from '../helpers/fetch';

const status = {
  enabled: true,
  frequency: 'week',
  keep: 3,
  dir: '/data/backups',
  writable: true,
  running: false,
  lastAt: 1_730_822_400_000,
  nextAt: 1_731_427_200_000,
  lastError: null,
  backups: [{ name: 'todoness-backup-20261115-100000.zip', size: 1234, createdAt: 1 }],
};

afterEach(() => vi.unstubAllGlobals());

describe('fetchBackup', () => {
  it('reads the status', async () => {
    const f = fakeFetch(() => json(200, status));
    vi.stubGlobal('fetch', f);
    expect(await fetchBackup()).toEqual({ ok: true, status });
    expect(f.calls[0]).toMatchObject({ url: '/api/admin/backup', method: 'GET' });
  });

  it('is not ok for an error, a network failure or an answer in the wrong shape', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch(() => json(403, { error: 'forbidden' })),
    );
    expect(await fetchBackup()).toEqual({ ok: false });
    vi.stubGlobal(
      'fetch',
      fakeFetch(() => 'network-error'),
    );
    expect(await fetchBackup()).toEqual({ ok: false });
    vi.stubGlobal(
      'fetch',
      fakeFetch(() => json(200, { enabled: true })),
    );
    expect(await fetchBackup()).toEqual({ ok: false });
  });
});

describe('saveBackup', () => {
  it('sends the three settings and returns the new status', async () => {
    const f = fakeFetch(() => json(200, { ...status, keep: 5 }));
    vi.stubGlobal('fetch', f);
    const r = await saveBackup({ enabled: true, frequency: 'week', keep: 5 });
    expect(r).toEqual({ ok: true, status: { ...status, keep: 5 } });
    expect(f.calls[0]).toMatchObject({
      url: '/api/admin/backup',
      method: 'PUT',
      body: { enabled: true, frequency: 'week', keep: 5 },
    });
  });

  it('is not ok when the server refuses', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch(() => json(400, { error: 'invalid_request' })),
    );
    expect(await saveBackup({ enabled: true, frequency: 'day', keep: 3 })).toEqual({ ok: false });
  });
});

describe('runBackup', () => {
  it('starts a backup and returns the status (202)', async () => {
    const f = fakeFetch(() => json(202, { ...status, running: true }));
    vi.stubGlobal('fetch', f);
    expect(await runBackup()).toEqual({ ok: true, status: { ...status, running: true } });
    expect(f.calls[0]).toMatchObject({ url: '/api/admin/backup/run', method: 'POST' });
  });

  it('says so when one is already running (409)', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch(() => json(409, { error: 'running' })),
    );
    expect(await runBackup()).toEqual({ ok: false, running: true });
  });

  it('is not ok for any other failure', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch(() => 'network-error'),
    );
    expect(await runBackup()).toEqual({ ok: false, running: false });
  });
});
