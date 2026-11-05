/**
 * The only code that changes data (docs/MVPImplementationSteps.md, Step 2).
 *
 * Every change is ONE transaction that
 *   1. builds the new row with the shared `applyOp` (the same rules the server uses),
 *   2. saves the row, and
 *   3. appends the operation to the outbox,
 * so the screen and the queue of pending changes never get out of step.
 */
import { generateKeyBetween } from 'fractional-indexing';
import Dexie from 'dexie';
import {
  HlcClock,
  applyOp,
  newClientId,
  newId,
  syncOpSchema,
  type List,
  type OpType,
  type Todo,
  type TodoPatch,
} from '@todoness/shared';
import type { TodonessDB } from './db';

export type RepoErrorCode = 'invalid' | 'not_found' | 'inbox_protected';

export class RepoError extends Error {
  override name = 'RepoError';
  constructor(
    readonly code: RepoErrorCode,
    message: string = code,
  ) {
    super(message);
  }
}

export interface NewTodo {
  listId: string;
  title: string;
  notes?: string;
  dueAt?: number | null;
  priority?: 0 | 1 | 2 | 3;
}

export interface Repo {
  createTodo(input: NewTodo): Promise<Todo>;
  updateTodo(id: string, patch: TodoPatch): Promise<Todo>;
  setDone(id: string, done: boolean): Promise<Todo>;
  deleteTodo(id: string): Promise<Todo>;
  restoreTodo(id: string): Promise<Todo>;
  moveTodo(id: string, listId: string): Promise<Todo>;
  createList(name: string): Promise<List>;
  renameList(id: string, name: string): Promise<List>;
  deleteList(id: string): Promise<List>;
  /** Moves a list one place up or down among the visible lists (never above the Inbox). */
  moveList(id: string, direction: 'up' | 'down'): Promise<List>;
}

export function createRepo(db: TodonessDB, opts: { now?: () => number } = {}): Repo {
  const now = opts.now ?? Date.now;

  const inTx = <T>(fn: () => Promise<T>) =>
    db.transaction('rw', [db.todos, db.lists, db.outbox, db.meta], fn);

  /** Next clock value for this browser; remembered in `meta` so it survives reloads. */
  async function nextHlc(): Promise<string> {
    let clientId = await db.getMeta<string>('clientId');
    if (!clientId) {
      clientId = newClientId();
      await db.setMeta('clientId', clientId);
    }
    const last = await db.getMeta<string>('lastHlc');
    const hlc = new HlcClock(clientId, now, last).now();
    await db.setMeta('lastHlc', hlc);
    return hlc;
  }

  /** Validates, applies and queues one operation. Returns the resulting row. */
  async function commit<T extends Todo | List>(
    entity: 'todo' | 'list',
    type: OpType,
    entityId: string,
    patch: Record<string, unknown>,
  ): Promise<T> {
    const table = (entity === 'todo' ? db.todos : db.lists) as unknown as Dexie.Table<T, string>;
    const existing = await table.get(entityId);

    const parsed = syncOpSchema.safeParse({
      opId: newId(now()),
      entity,
      entityId,
      type,
      patch,
      hlc: await nextHlc(),
    });
    if (!parsed.success) throw new RepoError('invalid', parsed.error.message);
    const op = parsed.data;

    const result = applyOp<T>(existing, op);
    if (!result.ok) {
      throw new RepoError(result.reason === 'not_found' ? 'not_found' : 'invalid');
    }
    if (!result.changed) return existing as T;

    await table.put(result.row);
    await db.outbox.add({ ...op, attempts: 0, createdAt: now() });
    return result.row;
  }

  async function liveTodo(id: string): Promise<Todo> {
    const t = await db.todos.get(id);
    if (!t || t.deletedAt !== null) throw new RepoError('not_found', 'Todo not found');
    return t;
  }

  async function liveList(id: string): Promise<List> {
    const l = await db.lists.get(id);
    if (!l || l.deletedAt !== null) throw new RepoError('not_found', 'List not found');
    return l;
  }

  /** A key that sorts before every todo of the list, so the new one lands on top. */
  async function topKey(listId: string): Promise<string> {
    const first = await db.todos
      .where('[listId+orderKey]')
      .between([listId, Dexie.minKey], [listId, Dexie.maxKey])
      .first();
    return generateKeyBetween(null, first?.orderKey ?? null);
  }

  return {
    createTodo: (input) =>
      inTx(async () => {
        await liveList(input.listId);
        const patch: Record<string, unknown> = {
          listId: input.listId,
          title: input.title,
          orderKey: await topKey(input.listId),
        };
        if (input.notes !== undefined) patch.notes = input.notes;
        if (input.dueAt !== undefined) patch.dueAt = input.dueAt;
        if (input.priority !== undefined) patch.priority = input.priority;
        return commit<Todo>('todo', 'create', newId(now()), patch);
      }),

    updateTodo: (id, patch) =>
      inTx(async () => {
        await liveTodo(id);
        return commit<Todo>('todo', 'update', id, patch);
      }),

    setDone: (id, done) =>
      inTx(async () => {
        const todo = await liveTodo(id);
        if (todo.done === done) return todo;
        return commit<Todo>('todo', 'update', id, {
          done,
          completedAt: done ? now() : null,
        });
      }),

    deleteTodo: (id) =>
      inTx(async () => {
        const todo = await db.todos.get(id);
        if (!todo) throw new RepoError('not_found', 'Todo not found');
        if (todo.deletedAt !== null) return todo;
        return commit<Todo>('todo', 'delete', id, {});
      }),

    restoreTodo: (id) =>
      inTx(async () => {
        const todo = await db.todos.get(id);
        if (!todo) throw new RepoError('not_found', 'Todo not found');
        if (todo.deletedAt === null) return todo;
        return commit<Todo>('todo', 'restore', id, {});
      }),

    moveTodo: (id, listId) =>
      inTx(async () => {
        await liveTodo(id);
        await liveList(listId);
        return commit<Todo>('todo', 'update', id, { listId, orderKey: await topKey(listId) });
      }),

    createList: (name) =>
      inTx(async () => {
        const last = await db.lists.orderBy('orderKey').last();
        return commit<List>('list', 'create', newId(now()), {
          name,
          orderKey: generateKeyBetween(last?.orderKey ?? null, null),
        });
      }),

    renameList: (id, name) =>
      inTx(async () => {
        const list = await liveList(id);
        if (list.isInbox) throw new RepoError('inbox_protected', 'The Inbox cannot be renamed');
        return commit<List>('list', 'update', id, { name });
      }),

    moveList: (id, direction) =>
      inTx(async () => {
        const list = await liveList(id);
        if (list.isInbox) throw new RepoError('inbox_protected', 'The Inbox cannot be moved');

        const all = (await db.lists.orderBy('orderKey').toArray()).filter(
          (l) => l.deletedAt === null,
        );
        const i = all.findIndex((l) => l.id === id);
        const neighbor = all[direction === 'up' ? i - 1 : i + 1];
        if (!neighbor || neighbor.isInbox) return list; // already at the end

        // A new key between the neighbour and the list after it (or before it).
        let lo: string | null;
        let hi: string | null;
        if (direction === 'up') {
          lo = all[i - 2]?.orderKey ?? null;
          hi = neighbor.orderKey;
        } else {
          lo = neighbor.orderKey;
          hi = all[i + 2]?.orderKey ?? null;
        }
        // Two devices can create lists with the same key; then just step past the neighbour.
        if (lo !== null && hi !== null && lo >= hi) {
          if (direction === 'down') hi = null;
          else lo = null;
        }
        return commit<List>('list', 'update', id, { orderKey: generateKeyBetween(lo, hi) });
      }),

    deleteList: (id) =>
      inTx(async () => {
        const list = await db.lists.get(id);
        if (!list) throw new RepoError('not_found', 'List not found');
        if (list.isInbox) throw new RepoError('inbox_protected', 'The Inbox cannot be deleted');
        if (list.deletedAt !== null) return list;
        const todos = await db.todos.where('listId').equals(id).toArray();
        for (const t of todos) {
          if (t.deletedAt === null) await commit<Todo>('todo', 'delete', t.id, {});
        }
        return commit<List>('list', 'delete', id, {});
      }),
  };
}
