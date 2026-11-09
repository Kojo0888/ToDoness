import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

/** Unknown paths answer with JSON, like the rest of the API. */
export function notFound(c: Context) {
  return c.json({ error: 'not_found' }, 404);
}

/** Turns thrown errors into the API's `{ error }` JSON shape. */
export function onError(err: Error, c: Context) {
  if (err instanceof HTTPException) {
    return c.json({ error: err.status === 400 ? 'bad_request' : err.message }, err.status);
  }
  if (err instanceof SyntaxError) return c.json({ error: 'bad_request' }, 400); // malformed JSON
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
}
