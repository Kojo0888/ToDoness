/**
 * Runs asynchronous tasks one after the other, in the order they were handed in. Each call
 * resolves (or rejects) with its own task's outcome; a failing task does not stop the ones
 * behind it.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return (task) => {
    const mine = last.then(task, task);
    last = mine.catch(() => undefined);
    return mine;
  };
}
