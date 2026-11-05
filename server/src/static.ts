import type { MiddlewareHandler } from 'hono';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const IMMUTABLE = 'public, max-age=31536000, immutable';

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Serves the built web app from `root`.
 * - Files under `/assets/` have hashed names, so they are cached for a long time.
 * - Everything else (index.html, sw.js, manifest) is revalidated every time, so
 *   a new version of the app is noticed.
 * - Unknown paths without a file extension get index.html (client-side routes).
 */
export function staticMiddleware(root: string): MiddlewareHandler {
  const base = resolve(root);

  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return next();
    }
    if (pathname.includes('\0') || pathname === '/api' || pathname.startsWith('/api/')) {
      return next();
    }

    const target = resolve(join(base, pathname));
    const inside = target === base || target.startsWith(base + sep);

    let file: string | undefined;
    if (inside && pathname !== '/' && (await isFile(target))) {
      file = target;
    } else if (!extname(pathname)) {
      file = join(base, 'index.html'); // client-side route
    }
    if (file === undefined || !(await isFile(file))) return next();

    const body = await readFile(file);
    const headers = new Headers({
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': pathname.startsWith('/assets/') ? IMMUTABLE : 'no-cache',
      'content-length': String(body.length),
    });
    return new Response(c.req.method === 'HEAD' ? null : body, { headers });
  };
}
