import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { staticMiddleware } from '../src/static';

let app: Hono;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'todoness-static-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<html>app</html>');
  writeFileSync(join(dir, 'sw.js'), 'self.skipWaiting()');
  writeFileSync(join(dir, 'manifest.webmanifest'), '{}');
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'assets', 'style-abc123.css'), 'body{}');
  writeFileSync(join(dir, 'icon.svg'), '<svg/>');
  writeFileSync(join(tmpdir(), 'todoness-secret.txt'), 'secret');
  app = new Hono();
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.use('*', staticMiddleware(dir));
  app.notFound((c) => c.text('not found', 404));
});

describe('staticMiddleware', () => {
  it('serves index.html at /', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe('<html>app</html>');
  });

  it('serves files with the right content type', async () => {
    expect((await app.request('/assets/index-abc123.js')).headers.get('content-type')).toContain(
      'javascript',
    );
    expect((await app.request('/assets/style-abc123.css')).headers.get('content-type')).toContain(
      'text/css',
    );
    expect((await app.request('/icon.svg')).headers.get('content-type')).toContain('image/svg+xml');
    expect((await app.request('/manifest.webmanifest')).headers.get('content-type')).toContain(
      'application/manifest+json',
    );
  });

  it('caches hashed assets for a long time', async () => {
    const res = await app.request('/assets/index-abc123.js');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('never caches index.html or the service worker for long', async () => {
    expect((await app.request('/')).headers.get('cache-control')).toBe('no-cache');
    expect((await app.request('/sw.js')).headers.get('cache-control')).toBe('no-cache');
  });

  it('falls back to index.html for client routes', async () => {
    const res = await app.request('/l/some-list/t/some-todo');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>app</html>');
  });

  it('does not fall back for /api routes or missing assets', async () => {
    expect((await app.request('/api/nope')).status).toBe(404);
    expect((await app.request('/assets/missing.js')).status).toBe(404);
    expect((await app.request('/missing.png')).status).toBe(404);
  });

  it('does not leave the folder (path traversal)', async () => {
    for (const p of [
      '/../todoness-secret.txt',
      '/%2e%2e/todoness-secret.txt',
      '/..%2ftodoness-secret.txt',
    ]) {
      const res = await app.request(p);
      expect(await res.text(), p).not.toBe('secret');
    }
  });

  it('only answers GET and HEAD', async () => {
    const res = await app.request('/', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('does not shadow other routes', async () => {
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true });
  });
});
