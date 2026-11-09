import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/db/connection';
import { migrate, MIGRATIONS_DIR } from '../src/db/migrate';
import { startReminderSweeper } from '../src/push/sweeper';

describe('startReminderSweeper', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function db() {
    const d = openDatabase(':memory:');
    migrate(d, MIGRATIONS_DIR);
    return d;
  }

  it('sweeps at once and then on every interval until stopped', async () => {
    const database = db();
    const spy = vi.spyOn(database, 'prepare');
    const stop = startReminderSweeper({ db: database, send: async () => 'ok', intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    const afterFirst = spy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(1000);
    const afterSecond = spy.mock.calls.length;
    expect(afterSecond).toBeGreaterThan(afterFirst);

    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(spy.mock.calls.length).toBe(afterSecond);
  });

  it('keeps running when a sweep fails', async () => {
    const database = db();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    database.close(); // every sweep now throws
    const stop = startReminderSweeper({ db: database, send: async () => 'ok', intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(error).toHaveBeenCalledTimes(3);
    stop();
    error.mockRestore();
  });
});
