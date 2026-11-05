import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

describe('GET /api/health', () => {
  it('answers 200 with status ok', async () => {
    const res = await createApp().request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('answers 404 for an unknown route', async () => {
    const res = await createApp().request('/api/nope');
    expect(res.status).toBe(404);
  });
});
