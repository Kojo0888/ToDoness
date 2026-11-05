/** The browser's local database (docs/DBModel.md section 4). */
import Dexie, { type Table } from 'dexie';
import type { List, OutboxOp, Todo } from '@todoness/shared';

export interface MetaRow {
  key: string;
  value: unknown;
}

/** An operation the server refused (or that could not be sent), kept for the user to see. */
export type DeadLetter = OutboxOp & { failedAt: number; reason: string };

/**
 * `meta` keys:
 *  - clientId        random id of this browser, sent with every sync call
 *  - lastHlc         the last clock value this browser produced
 *  - lastServerSeq   pull cursor
 *  - userId, user    who is logged in on this device (`user` = id, e-mail, role)
 *  - initialSyncDone true once the first full pull finished
 *  - pendingLogout   the user logged out offline; the server still has to be told
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

  constructor(name = 'todoness') {
    super(name);
    this.version(1).stores({
      lists: 'id, orderKey',
      todos: 'id, listId, [listId+orderKey]',
      outbox: 'opId, hlc, entityId',
      deadLetter: 'opId, failedAt',
      meta: 'key',
    });
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value });
  }

  /** Removes everything stored for the logged-in user (logout, or a different user logs in). */
  async clearAll(): Promise<void> {
    await this.transaction(
      'rw',
      [this.lists, this.todos, this.outbox, this.deadLetter, this.meta],
      () =>
        Promise.all([
          this.lists.clear(),
          this.todos.clear(),
          this.outbox.clear(),
          this.deadLetter.clear(),
          this.meta.clear(),
        ]),
    );
  }
}
