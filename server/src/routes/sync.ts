import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  normalizeRemindBefore,
  pushEnvelopeSchema,
  toLegacyRemindBefore,
  type PullResponse,
} from '@todoness/shared';
import { requireAuth } from '../auth/middleware';
import { applyPush } from '../sync/apply-ops';
import type { AppEnv } from '../http/types';

const PULL_DEFAULT = 500;
const PULL_MAX = 1000;
const PUSH_BODY_MAX = 1024 * 1024;

function wholeNumber(value: string | undefined, fallback: number): number | undefined {
  if (value === undefined) return fallback;
  return /^\d+$/.test(value) ? Number(value) : undefined;
}

export function syncRoutes({ db, now }: { db: Database.Database; now: () => number }) {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(db, now));

  app.post(
    '/push',
    bodyLimit({ maxSize: PUSH_BODY_MAX, onError: (c) => c.json({ error: 'too_large' }, 413) }),
    async (c) => {
      const parsed = pushEnvelopeSchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
      const { clientId, ops } = parsed.data;
      return c.json(applyPush(db, c.get('user').id, clientId, ops, now()));
    },
  );

  app.get('/pull', (c) => {
    const since = wholeNumber(c.req.query('since'), 0);
    const limitRaw = wholeNumber(c.req.query('limit'), PULL_DEFAULT);
    if (since === undefined || limitRaw === undefined || limitRaw < 1) {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const limit = Math.min(limitRaw, PULL_MAX);
    // Apps from before several reminders per task check `remindBefore` as one value or null
    // and reject the whole answer otherwise, so they only get the earliest reminder.
    // The current app asks for lists (`reminders=list`). docs/ui-refresh, FR-115.
    const remindersAsList = c.req.query('reminders') === 'list';

    const rows = db
      .prepare(
        `SELECT server_seq, entity, entity_id, op_type, patch, hlc
           FROM change_log
          WHERE user_id = ? AND server_seq > ?
          ORDER BY server_seq
          LIMIT ?`,
      )
      .all(c.get('user').id, since, limit + 1) as {
      server_seq: number;
      entity: 'todo' | 'list' | 'note';
      entity_id: string;
      op_type: 'create' | 'update' | 'delete' | 'restore';
      patch: string;
      hlc: string;
    }[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const body = {
      changes: page.map((r) => ({
        serverSeq: r.server_seq,
        entity: r.entity,
        entityId: r.entity_id,
        type: r.op_type,
        patch: remindersAsList ? JSON.parse(r.patch) : legacyPatch(r.entity, JSON.parse(r.patch)),
        hlc: r.hlc,
      })),
      nextSeq: page.at(-1)?.server_seq ?? since,
      hasMore,
    } as PullResponse;
    return c.json(body);
  });

  return app;
}

/** A pulled patch in the v1 format: `remindBefore` as one value or null. */
function legacyPatch(entity: string, patch: Record<string, unknown>): Record<string, unknown> {
  if (entity !== 'todo' || !('remindBefore' in patch)) return patch;
  return {
    ...patch,
    remindBefore: toLegacyRemindBefore(normalizeRemindBefore(patch.remindBefore)),
  };
}
