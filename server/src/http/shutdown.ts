import type { Server } from 'node:http';

/**
 * Stops the HTTP server without hanging. `server.close()` alone waits for every connection to
 * end, and a connection a browser opened in advance but never used (a pre-connect) is not
 * "idle" to Node, so it was never closed: the process kept running until it was killed.
 * Idle connections are closed at once, a request under way gets `graceMs` to finish, then
 * whatever is left is closed.
 */
export function closeServer(server: Server, opts: { graceMs?: number } = {}): Promise<void> {
  const graceMs = opts.graceMs ?? 3000;
  return new Promise((resolve) => {
    const timer = setTimeout(() => server.closeAllConnections(), graceMs);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    server.closeIdleConnections();
  });
}
