import { describe, expect, it } from 'vitest';
import { createSerialQueue } from '../../src/lib/serial';

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('createSerialQueue', () => {
  it('runs tasks one after the other, in the order they were given', async () => {
    const run = createSerialQueue();
    const log: string[] = [];
    const slow = run(async () => {
      log.push('a start');
      await later(20);
      log.push('a end');
      return 1;
    });
    const fast = run(async () => {
      log.push('b start');
      return 2;
    });
    expect(await Promise.all([slow, fast])).toEqual([1, 2]);
    expect(log).toEqual(['a start', 'a end', 'b start']);
  });

  it('a failing task rejects its own promise and does not stop the queue', async () => {
    const run = createSerialQueue();
    const bad = run(async () => {
      throw new Error('no');
    });
    const good = run(async () => 'ok');
    await expect(bad).rejects.toThrow('no');
    expect(await good).toBe('ok');
  });
});
