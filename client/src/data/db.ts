/** The browser's local database (docs/mvp/DBModel.md section 4). */
import Dexie, { type Table } from 'dexie';
import type { List, OutboxOp, Todo } from '@todoness/shared';

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

export type DeadLetter = OutboxOp & { failedAt: number; reason: string };

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
 *
 * Only strings and numbers can be indexed, so `deletedAt` (null) and the
 * booleans have no index; they are filtered in code. The data is small.
 */
export class TodonessDB extends Dexie {
  lists!: Table<List, string>;
  todos!: Table<Todo, string>;
  outbox!: Table<OutboxOp, string>;
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
      [this.lists, this.todos, this.outbox, this.deadLetter, this.meta, this.notified],
      () =>
        Promise.all([
          this.lists.clear(),
          this.todos.clear(),
          this.outbox.clear(),
          this.deadLetter.clear(),
          this.meta.clear(),
          this.notified.clear(),
        ]).then(() => this.meta.bulkPut(keep)),
    );
  }
}
