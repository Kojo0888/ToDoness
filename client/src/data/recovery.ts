/**
 * Data kept aside when a different account signs up on this device
 * (docs/v1/PRD.md section 4.11). Pure functions on the local database; the
 * restore itself is `Repo.restoreSnapshot`, because only the repo changes data.
 */
import {
  normalizeRemindBefore,
  type Activity,
  type List,
  type Note,
  type Plan,
  type Todo,
} from '@todoness/shared';
import type { TodonessDB } from './db';

/** `meta` key the snapshot is stored under. */
export const RECOVERY_KEY = 'recoverySnapshot';

export type RestoreMode = 'append' | 'overwrite';

export interface RecoverySnapshot {
  /** The account the data belonged to. */
  fromEmail: string;
  takenAt: number;
  /** Live lists except the Inbox (the new account has its own Inbox). */
  lists: List[];
  /** Live tasks. Those whose list is not in `lists` belonged to the old Inbox. */
  todos: Todo[];
  /**
   * Live notes (docs/notes/PRD.md FR-98). Missing in a copy kept before the notes update,
   * so readers use `notes ?? []`.
   */
  notes: Note[];
  /**
   * Live plans and the live activities of those plans (docs/plan/PRD.md FR-144). Missing in
   * a copy kept before the Plan module, so readers use `?? []`.
   */
  plans?: Plan[];
  activities?: Activity[];
}

/**
 * What is on this device and worth restoring: live lists (not the Inbox), live tasks of
 * live lists and live notes. `undefined` when there is nothing, so the user is not asked about nothing.
 * Deleted rows are not restored.
 */
export async function takeSnapshot(
  db: TodonessDB,
  fromEmail: string,
  now: () => number = Date.now,
): Promise<RecoverySnapshot | undefined> {
  const liveLists = (await db.lists.toArray()).filter((l) => l.deletedAt === null);
  const liveListIds = new Set(liveLists.map((l) => l.id));
  const lists = liveLists.filter((l) => !l.isInbox);
  const todos = (await db.todos.toArray()).filter(
    (t) => t.deletedAt === null && liveListIds.has(t.listId),
  );
  const notes = (await db.notes.toArray()).filter((n) => n.deletedAt === null);
  const plans = (await db.plans.toArray()).filter((p) => p.deletedAt === null);
  const planIds = new Set(plans.map((p) => p.id));
  const activities = (await db.activities.toArray()).filter(
    (a) => a.deletedAt === null && planIds.has(a.planId),
  );
  if (lists.length + todos.length + notes.length + plans.length === 0) return undefined;
  return { fromEmail, takenAt: now(), lists, todos, notes, plans, activities };
}

/**
 * What uploading a copy writes, row by row (the fields `Repo.restoreSnapshot` sends), keyed
 * by entity and id. Tasks whose list is not in the copy belong to the Inbox; notes whose
 * note list is not in the copy belong to My notes.
 */
function uploaded(copy: RecoverySnapshot): Map<string, string> {
  const moduleOf = (l: List) => l.module ?? 'tasks';
  const taskLists = new Set(copy.lists.filter((l) => moduleOf(l) === 'tasks').map((l) => l.id));
  const noteLists = new Set(copy.lists.filter((l) => moduleOf(l) === 'notes').map((l) => l.id));
  const rows = new Map<string, string>();
  const add = (key: string, value: unknown[]) => rows.set(key, JSON.stringify(value));
  for (const l of copy.lists) add(`list:${l.id}`, [l.name, l.orderKey, l.isPublic, moduleOf(l)]);
  for (const t of copy.todos) {
    add(`todo:${t.id}`, [
      taskLists.has(t.listId) ? t.listId : 'inbox',
      t.title,
      t.orderKey,
      t.notes,
      t.done,
      t.completedAt,
      t.dueAt,
      t.priority,
      normalizeRemindBefore(t.remindBefore),
    ]);
  }
  for (const n of copy.notes ?? []) {
    const listId = n.listId != null && noteLists.has(n.listId) ? n.listId : null;
    add(`note:${n.id}`, [listId, n.text, n.orderKey, n.isPublic]);
  }
  for (const p of copy.plans ?? []) add(`plan:${p.id}`, [p.name, p.orderKey]);
  const planIds = new Set((copy.plans ?? []).map((p) => p.id));
  for (const a of copy.activities ?? []) {
    if (!planIds.has(a.planId)) continue;
    add(`activity:${a.id}`, [
      a.planId,
      a.name,
      a.start,
      a.days,
      [...a.dependsOn].sort(),
      a.done ?? false, // missing in a copy kept before done activities
      a.orderKey,
    ]);
  }
  return rows;
}

/**
 * Whether two copies hold the same data: uploading one where the other is would change
 * nothing (docs/recovery-upload FR-168, decision U3). Clocks and timestamps do not count.
 */
export function sameData(a: RecoverySnapshot, b: RecoverySnapshot): boolean {
  const x = uploaded(a);
  const y = uploaded(b);
  if (x.size !== y.size) return false;
  for (const [key, value] of x) if (y.get(key) !== value) return false;
  return true;
}
