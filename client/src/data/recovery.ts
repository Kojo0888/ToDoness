/**
 * Data kept aside when a different account signs up on this device
 * (docs/v1/PRD.md section 4.11). Pure functions on the local database; the
 * restore itself is `Repo.restoreSnapshot`, because only the repo changes data.
 */
import type { Activity, List, Note, Plan, Todo } from '@todoness/shared';
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
