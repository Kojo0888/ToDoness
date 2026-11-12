import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  normalizeRemindBefore,
  pushEnvelopeSchema,
  toLegacyRemindBefore,
  type Entity,
  type PullResponse,
} from '@todoness/shared';
import type { HlcClock } from '@todoness/shared';
import { requireAuth } from '../auth/middleware';
import { ensureNotesList } from '../auth/users';
import { applyPush } from '../sync/apply-ops';
import type { AppEnv } from '../http/types';

const PULL_DEFAULT = 500;
const PULL_MAX = 1000;
const PUSH_BODY_MAX = 1024 * 1024;

function wholeNumber(value: string | undefined, fallback: number): number | undefined {
  if (value === undefined) return fallback;
  return /^\d+$/.test(value) ? Number(value) : undefined;
}

export function syncRoutes({
  db,
  now,
  serverClock,
}: {
  db: Database.Database;
  now: () => number;
  serverClock: HlcClock;
}) {
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
    // Apps from before the Plan module refuse an answer with an entity they do not know, so
    // plans and activities are only sent to apps that ask for them (`plans=1`). The cursor
    // still moves past them; such an app reads everything again once it is updated
    // (client/src/data/db.ts, version 7). docs/plan/PRD.md FR-143.
    const withPlans = c.req.query('plans') === '1';
    // Apps from before note lists (docs/note-lists, decision L4) would take a note list for
    // a task list and reject a note's `listId`. The current app asks with `lists=modules`.
    const knowsModules = c.req.query('lists') === 'modules';
    // Apps from before done activities (docs/plan/PRD.md FR-159) refuse the unknown field,
    // so it is left out for them; an update of `done` alone becomes an empty patch.
    const knowsDone = c.req.query('activities') === 'done';
    const userId = c.get('user').id;

    // Accounts from before note lists get "My notes" at their first sync (FR-124).
    db.transaction(() => ensureNotesList(db, userId, now(), () => serverClock.now())).immediate();

    const rows = db
      .prepare(
        `SELECT server_seq, entity, entity_id, op_type, patch, hlc
           FROM change_log
          WHERE user_id = ? AND server_seq > ?
          ORDER BY server_seq
          LIMIT ?`,
      )
      .all(userId, since, limit + 1) as {
      server_seq: number;
      entity: Entity;
      entity_id: string;
      op_type: 'create' | 'update' | 'delete' | 'restore';
      patch: string;
      hlc: string;
    }[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const noteLists = knowsModules
      ? undefined
      : new Set(
          (
            db
              .prepare("SELECT id FROM lists WHERE user_id = ? AND module = 'notes'")
              .all(userId) as {
              id: string;
            }[]
          ).map((r) => r.id),
        );
    const shown = noteLists
      ? page.filter((r) => !(r.entity === 'list' && noteLists.has(r.entity_id)))
      : page;
    const body = {
      changes: shown
        .filter((r) => withPlans || (r.entity !== 'plan' && r.entity !== 'activity'))
        .map((r) => ({
          serverSeq: r.server_seq,
          entity: r.entity,
          entityId: r.entity_id,
          type: r.op_type,
          patch: ((p: Record<string, unknown>) => {
            const q = knowsModules ? p : withoutModules(r.entity, p);
            return knowsDone ? q : withoutDone(r.entity, q);
          })(remindersAsList ? JSON.parse(r.patch) : legacyPatch(r.entity, JSON.parse(r.patch))),
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

/** For apps from before note lists: no `module` on lists, no `listId` on notes. */
function withoutModules(entity: string, patch: Record<string, unknown>): Record<string, unknown> {
  const field = entity === 'list' ? 'module' : entity === 'note' ? 'listId' : undefined;
  if (field === undefined || !(field in patch)) return patch;
  const rest = { ...patch };
  delete rest[field];
  return rest;
}

/** For apps from before done activities: no `done` on activities. */
function withoutDone(entity: string, patch: Record<string, unknown>): Record<string, unknown> {
  if (entity !== 'activity' || !('done' in patch)) return patch;
  const rest = { ...patch };
  delete rest.done;
  return rest;
}
