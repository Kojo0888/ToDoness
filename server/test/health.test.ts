import { describe, expect, it } from 'vitest';
import { testApp } from './helpers/app';

describe('GET /api/health', () => {
  it('answers 200 with status ok when the database answers', async () => {
    const { app } = testApp();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('answers 503 when the database is closed', async () => {
    const { app, db } = testApp();
    db.close();
    const res = await app.request('/api/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'error' });
  });
});

describe('errors', () => {
  it('answers unknown API routes with a JSON 404', async () => {
    const { app } = testApp();
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('answers unexpected failures with a JSON 500 and no details', async () => {
    const { app } = testApp();
    app.get('/api/boom', () => {
      throw new Error('secret detail');
    });
    const res = await app.request('/api/boom');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'internal_error' });
  });

  it('answers malformed JSON bodies with 400', async () => {
    const { app } = testApp();
    app.post('/api/echo', async (c) => c.json(await c.req.json()));
    const res = await app.request('/api/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });
});
