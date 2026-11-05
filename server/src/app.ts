import { Hono } from 'hono';

/** Builds the HTTP app. Kept separate from `index.ts` so tests can call it directly. */
export function createApp() {
  const app = new Hono();

  // Step 3 will also check that the database answers.
  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  return app;
}
