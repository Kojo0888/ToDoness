/**
 * Data kept aside when a different account signs up on this device
 * (docs/v1/PRD.md section 4.11). Pure functions on the local database; the
 * restore itself is `Repo.restoreSnapshot`, because only the repo changes data.
 */
import type { List, Todo } from '@todoness/shared';
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
}

/**
 * What is on this device and worth restoring: live lists (not the Inbox) and live tasks of
 * live lists. `undefined` when there is nothing, so the user is not asked about nothing.
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
  if (lists.length === 0 && todos.length === 0) return undefined;
  return { fromEmail, takenAt: now(), lists, todos };
}
