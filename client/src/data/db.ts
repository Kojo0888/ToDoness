/** The browser's local database (docs/mvp/DBModel.md section 4). */
import Dexie, { type Table } from 'dexie';
import {
  normalizeRemindBefore,
  type Activity,
  type List,
  type Note,
  type OutboxOp,
  type Plan,
  type Todo,
} from '@todoness/shared';

export interface MetaRow {
  key: string;
  value: unknown;
}

/** An operation the server refused (or that could not be sent), kept for the user to see. */
/** A reminder that already fired on this device (see app/reminders.ts). */
export interface NotifiedRow {
  key: string;
  at: number;
}

/**
 * A change to somebody else's public list or note, waiting to be sent through the restricted
 * push of that list or note (docs/notes/PRD.md FR-107, decision N8).
 */
export type PublicOp = OutboxOp & { target: 'list' | 'note'; targetId: string };

/** A copy of a public answer of the server: `lists`, `notes` or `list:<id>`. */
export interface PublicCacheRow {
  key: string;
  value: unknown;
  /** When the server gave it (or confirmed it with 304). */
  at: number;
  /**
   * Raised whenever this device writes into the copy itself (an accepted edit). A refresh
   * that started before only stores its answer if `rev` is unchanged: it would be older.
   */
  rev?: number;
  /** The server's ETag of `value`, sent back as If-None-Match. */
  etag?: string;
}

/** An operation the server refused; public ones keep their target, so the page can say so. */
export type DeadLetter = OutboxOp & {
  failedAt: number;
  reason: string;
  target?: 'list' | 'note';
  targetId?: string;
};

/**
 * `meta` keys:
 *  - clientId        random id of this browser, sent with every sync call
 *  - lastHlc         the last clock value this browser produced
 *  - lastServerSeq   pull cursor
 *  - userId, user    who is logged in on this device (`user` = id, e-mail, role)
 *  - initialSyncDone true once the first full pull finished
 *  - pendingLogout   the user logged out offline; the server still has to be told
 *  - recoverySnapshot data of another account kept aside until the user decides (data/recovery.ts)
 *
 * `notified` remembers which reminders already fired on this device (version 2).
 * `notes` holds the notes module (version 3, docs/notes/PRD.md).
 * `publicOutbox` and `publicCache` make other users' public data work offline (version 4).
 * `plans` and `activities` hold the Plan module (version 7, docs/plan/PRD.md).
 *
 * Only strings and numbers can be indexed, so `deletedAt` (null) and the
 * booleans have no index; they are filtered in code. The data is small.
 */
export class TodonessDB extends Dexie {
  lists!: Table<List, string>;
  todos!: Table<Todo, string>;
  notes!: Table<Note, string>;
  plans!: Table<Plan, string>;
  activities!: Table<Activity, string>;
  outbox!: Table<OutboxOp, string>;
  publicOutbox!: Table<PublicOp, string>;
  publicCache!: Table<PublicCacheRow, string>;
  deadLetter!: Table<DeadLetter, string>;
  meta!: Table<MetaRow, string>;
  notified!: Table<NotifiedRow, string>;

  constructor(name = 'todoness') {
    super(name);
    this.version(1).stores({
      lists: 'id, orderKey',
      todos: 'id, listId, [listId+orderKey]',
      outbox: 'opId, hlc, entityId',
      deadLetter: 'opId, failedAt',
      meta: 'key',
    });
    // v1 (docs/v1/TechStack.md section 2): list.isPublic, todo.remindBefore, `notified`.
    this.version(2)
      .stores({ notified: 'key' })
      .upgrade(async (tx) => {
        await tx
          .table('lists')
          .toCollection()
          .modify((l) => {
            l.isPublic ??= false;
          });
        await tx
          .table('todos')
          .toCollection()
          .modify((t) => {
            t.remindBefore ??= null;
          });
      });
    // Notes module: a new table, nothing else changes.
    this.version(3).stores({ notes: 'id, orderKey' });
    // Other users' public lists and notes offline: a copy of the server's answers and a queue.
    this.version(4).stores({ publicOutbox: 'opId, hlc, targetId', publicCache: 'key' });
    // Several reminders per task (docs/ui-refresh): `remindBefore` becomes a list.
    this.version(5).upgrade(async (tx) => {
      await tx
        .table('todos')
        .toCollection()
        .modify((t) => {
          t.remindBefore = normalizeRemindBefore(t.remindBefore);
        });
    });
    // Note lists (docs/note-lists): every stored list is a task list, every note is in
    // "My notes" (`listId: null`).
    this.version(6).upgrade(async (tx) => {
      await tx
        .table('lists')
        .toCollection()
        .modify((l) => {
          l.module ??= 'tasks';
        });
      await tx
        .table('notes')
        .toCollection()
        .modify((n) => {
          n.listId ??= null;
        });
    });
    // Plan module (docs/plan). The server leaves plans out of what it sends to an app from
    // before this version, and that app's pull cursor moved past them. Forgetting the cursor
    // makes the next sync read every change again (applying one twice changes nothing), so
    // plans made on other devices meanwhile arrive here too (FR-143).
    this.version(7)
      .stores({ plans: 'id, orderKey', activities: 'id, planId, [planId+orderKey]' })
      .upgrade(async (tx) => {
        await tx.table('meta').delete('lastServerSeq');
      });
    // Done activities (docs/plan, Update 3). The server leaves `done` out for apps that do
    // not ask for it, so the cursor is reset again to read the done states skipped (FR-159).
    this.version(8).upgrade(async (tx) => {
      await tx
        .table('activities')
        .toCollection()
        .modify((a) => {
          a.done ??= false;
        });
      await tx.table('meta').delete('lastServerSeq');
    });
    // Activity groups (docs/plan, Update 6). The server leaves `parentId` out for apps that do
    // not ask for it, so the cursor is reset again to read the groups skipped (FR-188).
    this.version(9).upgrade(async (tx) => {
      await tx
        .table('activities')
        .toCollection()
        .modify((a) => {
          a.parentId ??= null;
        });
      await tx.table('meta').delete('lastServerSeq');
    });
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value });
  }

  /**
   * Removes everything stored for the logged-in user (logout, or a different user logs in).
   * `keep` rows are written back in the same transaction, so they are never lost in between
   * (used for the data kept aside by the recovery, see data/recovery.ts).
   */
  async clearAll(keep: MetaRow[] = []): Promise<void> {
    await this.transaction(
      'rw',
      [
        this.lists,
        this.todos,
        this.notes,
        this.plans,
        this.activities,
        this.outbox,
        this.publicOutbox,
        this.publicCache,
        this.deadLetter,
        this.meta,
        this.notified,
      ],
      () =>
        Promise.all([
          this.publicOutbox.clear(),
          this.publicCache.clear(),
          this.lists.clear(),
          this.todos.clear(),
          this.notes.clear(),
          this.plans.clear(),
          this.activities.clear(),
          this.outbox.clear(),
          this.deadLetter.clear(),
          this.meta.clear(),
          this.notified.clear(),
        ]).then(() => this.meta.bulkPut(keep)),
    );
  }
}
