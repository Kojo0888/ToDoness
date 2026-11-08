/**
 * Applying pushed operations (docs/mvp/DBModel.md section 3.2).
 * The whole batch runs in one `BEGIN IMMEDIATE` transaction: SQLite allows one
 * writer at a time, so `server_seq` values become visible in order and a client
 * cursor can never skip a row that was committed late.
 */
import type Database from 'better-sqlite3';
import {
  applyOp,
  syncOpSchema,
  type List,
  type PushResponse,
  type SyncOp,
  type Todo,
} from '@todoness/shared';
import { getList, getTodo, listOwner, saveList, saveTodo } from './rows';

export type RejectReason =
  'invalid_operation' | 'not_found' | 'list_not_found' | 'inbox_protected' | 'forbidden';

/**
 * Editing somebody else's public list (docs/v1/TechStack.md section 6): the rows stay
 * owned by the list owner (`userId`), but the operations come from `actorId` and may only
 * be task operations inside `onlyListId`.
 */
export interface PushScope {
  actorId: string;
  onlyListId: string;
}

type Outcome = { ok: true } | { ok: false; reason: RejectReason };

export function applyPush(
  db: Database.Database,
  userId: string,
  clientId: string,
  rawOps: { opId: string }[],
  now: number,
  scope?: PushScope,
): PushResponse {
  const processedBy = scope?.actorId ?? userId;
  const markProcessed = db.prepare(
    'INSERT OR IGNORE INTO processed_ops (user_id, op_id, processed_at) VALUES (?, ?, ?)',
  );
  const unmark = db.prepare('DELETE FROM processed_ops WHERE user_id = ? AND op_id = ?');
  const log = db.prepare(
    `INSERT INTO change_log (user_id, client_id, entity, entity_id, op_type, patch, hlc, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  function writeLog(op: SyncOp, accepted: Record<string, unknown>) {
    log.run(
      userId,
      clientId,
      op.entity,
      op.entityId,
      op.type,
      JSON.stringify(accepted),
      op.hlc,
      now,
    );
  }

  function applyTodo(op: Extract<SyncOp, { entity: 'todo' }>): Outcome {
    const existing = getTodo(db, op.entityId);
    if (existing && existing.userId !== userId) return { ok: false, reason: 'not_found' };

    const targetList = 'listId' in op.patch ? op.patch.listId : undefined;
    if (scope) {
      // Only inside the public list: no moving tasks in or out, no taking over other rows.
      if (existing && existing.row.listId !== scope.onlyListId) {
        return { ok: false, reason: 'not_found' };
      }
      if (
        op.type === 'create'
          ? targetList !== scope.onlyListId
          : targetList !== undefined && targetList !== scope.onlyListId
      ) {
        return { ok: false, reason: 'list_not_found' };
      }
    }
    if (targetList !== undefined && listOwner(db, targetList) !== userId) {
      return { ok: false, reason: 'list_not_found' };
    }

    const r = applyOp<Todo>(existing?.row, op);
    if (!r.ok)
      return { ok: false, reason: r.reason === 'not_found' ? 'not_found' : 'invalid_operation' };
    if (r.changed) {
      saveTodo(db, userId, r.row);
      writeLog(op, r.accepted);
    }
    return { ok: true };
  }

  function applyList(op: Extract<SyncOp, { entity: 'list' }>): Outcome {
    const existing = getList(db, op.entityId);
    if (existing && existing.userId !== userId) return { ok: false, reason: 'not_found' };

    if (existing?.row.isInbox) {
      const renames = op.type === 'update' && 'name' in op.patch;
      if (op.type === 'delete' || renames) return { ok: false, reason: 'inbox_protected' };
    }

    const r = applyOp<List>(existing?.row, op);
    if (!r.ok)
      return { ok: false, reason: r.reason === 'not_found' ? 'not_found' : 'invalid_operation' };
    if (r.changed) {
      saveList(db, userId, r.row);
      writeLog(op, r.accepted);
    }
    return { ok: true };
  }

  const run = db.transaction((): PushResponse => {
    const accepted: string[] = [];
    const rejected: PushResponse['rejected'] = [];

    for (const raw of rawOps) {
      const parsed = syncOpSchema.safeParse(raw);
      if (!parsed.success) {
        rejected.push({ opId: raw.opId, reason: 'invalid_operation' });
        continue;
      }
      const op = parsed.data;

      if (scope && op.entity === 'list') {
        rejected.push({ opId: op.opId, reason: 'forbidden' });
        continue;
      }

      // Already applied earlier (a retry): report it accepted again and skip it.
      if (markProcessed.run(processedBy, op.opId, now).changes === 0) {
        accepted.push(op.opId);
        continue;
      }

      const outcome = op.entity === 'todo' ? applyTodo(op) : applyList(op);
      if (outcome.ok) {
        accepted.push(op.opId);
      } else {
        unmark.run(processedBy, op.opId); // a refused operation is not "processed"
        rejected.push({ opId: op.opId, reason: outcome.reason });
      }
    }
    return { accepted, rejected };
  });

  return run.immediate();
}
