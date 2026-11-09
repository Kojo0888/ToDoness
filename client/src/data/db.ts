/** The browser's local database (docs/mvp/DBModel.md section 4). */
import Dexie, { type Table } from 'dexie';
import type { List, Note, OutboxOp, Todo } from '@todoness/shared';

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
  /** When the server gave it. */
  at: number;
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
 *
 * Only strings and numbers can be indexed, so `deletedAt` (null) and the
 * booleans have no index; they are filtered in code. The data is small.
 */
export class TodonessDB extends Dexie {
  lists!: Table<List, string>;
  todos!: Table<Todo, string>;
  notes!: Table<Note, string>;
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
          this.outbox.clear(),
          this.deadLetter.clear(),
          this.meta.clear(),
          this.notified.clear(),
        ]).then(() => this.meta.bulkPut(keep)),
    );
  }
}
