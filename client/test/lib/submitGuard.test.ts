import { describe, expect, it } from 'vitest';
import { createSubmitGuard } from '../../src/lib/submitGuard';

const deferred = () => {
  let resolve!: (v: string) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('submit guard (docs/unstable-connection FR-255, FR-256)', () => {
  it('runs the action once while it is still running, however often it is pressed', async () => {
    const guard = createSubmitGuard();
    const d = deferred();
    let calls = 0;
    const action = () => {
      calls++;
      return d.promise;
    };
    const first = guard.run(action);
    for (let i = 0; i < 9; i++) expect(await guard.run(action)).toEqual({ ran: false });
    expect(calls).toBe(1);
    expect(guard.busy()).toBe(true);
    d.resolve('x');
    expect(await first).toEqual({ ran: true, value: 'x' });
    expect(guard.busy()).toBe(false);
  });

  it('can run again after it finished', async () => {
    const guard = createSubmitGuard();
    await guard.run(async () => 1);
    expect(await guard.run(async () => 2)).toEqual({ ran: true, value: 2 });
  });

  it('releases after a failure, and the failure still reaches the caller', async () => {
    const guard = createSubmitGuard();
    const d = deferred();
    const first = guard.run(() => d.promise);
    d.reject(new Error('boom'));
    await expect(first).rejects.toThrow('boom');
    expect(guard.busy()).toBe(false);
    expect(await guard.run(async () => 'again')).toEqual({ ran: true, value: 'again' });
  });

  it('tells subscribers when it becomes busy and idle', async () => {
    const guard = createSubmitGuard();
    const seen: boolean[] = [];
    guard.subscribe((b) => seen.push(b));
    await guard.run(async () => 1);
    expect(seen).toEqual([true, false]);
  });
});
