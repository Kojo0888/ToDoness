/** Stopping the server must not wait forever for a connection that never sends a request. */
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { describe, expect, it } from 'vitest';
import { closeServer } from '../src/http/shutdown';

function listen() {
  const server = createServer((_req, res) => res.end('ok'));
  return new Promise<{ server: typeof server; port: number }>((resolve) =>
    server.listen(0, () => resolve({ server, port: (server.address() as { port: number }).port })),
  );
}

describe('closeServer', () => {
  it('ends a connection that was opened but never used (a browser pre-connect)', async () => {
    const { server, port } = await listen();
    const socket = connect(port, 'localhost');
    await new Promise((r) => socket.once('connect', r));

    const t0 = Date.now();
    await closeServer(server, { graceMs: 200 });
    expect(Date.now() - t0).toBeLessThan(2000);
    socket.destroy();
  });

  it('lets a request that is under way finish within the grace time', async () => {
    let finish!: () => void;
    const server = createServer((_req, res) => {
      finish = () => res.end('done');
    });
    await new Promise<void>((r) => server.listen(0, () => r()));
    const port = (server.address() as { port: number }).port;
    const answer = fetch(`http://localhost:${port}/`).then((r) => r.text());
    await new Promise((r) => setTimeout(r, 100));

    const closed = closeServer(server, { graceMs: 2000 });
    setTimeout(() => finish(), 100);
    await expect(answer).resolves.toBe('done');
    await closed;
  });

  it('is quick when nothing is connected', async () => {
    const { server } = await listen();
    const t0 = Date.now();
    await closeServer(server, { graceMs: 5000 });
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
