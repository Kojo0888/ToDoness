/**
 * Editing somebody else's public list (docs/v1/PRD.md FR-33). Online only: every change
 * is one operation, built with this device's clock, sent to the server at once.
 * The server applies it like a normal push, but to the owner's data.
 */
import { newId, pushResponseSchema, syncOpSchema, type TodoPatch } from '@todoness/shared';
import { nextHlc } from '../data/clock';
import type { TodonessDB } from '../data/db';
import { keyForPosition, keyOnTop, type Keyed } from '../data/order';
import type { FetchFn } from '../sync/engine';

export type EditResult =
  | { ok: true }
  | { ok: false; error: 'offline' | 'gone' | 'auth' | 'rejected' | 'server' | 'invalid' };

export interface PublicEditor {
  createTodo(listId: string, title: string, firstOrderKey: string | null): Promise<EditResult>;
  updateTodo(listId: string, todoId: string, patch: TodoPatch): Promise<EditResult>;
  setDone(listId: string, todoId: string, done: boolean): Promise<EditResult>;
  deleteTodo(listId: string, todoId: string): Promise<EditResult>;
  restoreTodo(listId: string, todoId: string): Promise<EditResult>;
  /** Puts a task directly before another (`null` = at the end) among the open tasks. */
  reorder(
    listId: string,
    open: readonly Keyed[],
    todoId: string,
    beforeId: string | null,
  ): Promise<EditResult>;
  /** Called after every accepted change (the page reloads the list). */
  subscribe(listener: () => void): () => void;
}

export function createPublicEditor(deps: {
  db: TodonessDB;
  fetch: FetchFn;
  now?: () => number;
}): PublicEditor {
  const { db, fetch, now = Date.now } = deps;
  const listeners = new Set<() => void>();

  async function send(
    listId: string,
    type: 'create' | 'update' | 'delete' | 'restore',
    entityId: string,
    patch: Record<string, unknown>,
  ): Promise<EditResult> {
    const parsed = syncOpSchema.safeParse({
      opId: newId(now()),
      entity: 'todo',
      entityId,
      type,
      patch,
      hlc: await nextHlc(db, now),
    });
    if (!parsed.success) return { ok: false, error: 'invalid' };
    const op = parsed.data;

    let res: Response;
    try {
      res = await fetch(`/api/public/lists/${encodeURIComponent(listId)}/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: await db.getMeta<string>('clientId'), ops: [op] }),
      });
    } catch {
      return { ok: false, error: 'offline' };
    }
    if (res.status === 404) return { ok: false, error: 'gone' };
    if (res.status === 401) return { ok: false, error: 'auth' };
    if (!res.ok) return { ok: false, error: 'server' };

    const body = pushResponseSchema.safeParse(await res.json().catch(() => undefined));
    if (!body.success) return { ok: false, error: 'server' };
    if (!body.data.accepted.includes(op.opId)) return { ok: false, error: 'rejected' };

    for (const l of listeners) l();
    return { ok: true };
  }

  return {
    createTodo: (listId, title, firstOrderKey) =>
      send(listId, 'create', newId(now()), {
        listId,
        title,
        orderKey: keyOnTop(firstOrderKey),
      }),
    updateTodo: (listId, id, patch) => send(listId, 'update', id, patch),
    setDone: (listId, id, done) =>
      send(listId, 'update', id, { done, completedAt: done ? now() : null }),
    deleteTodo: (listId, id) => send(listId, 'delete', id, {}),
    restoreTodo: (listId, id) => send(listId, 'restore', id, {}),
    async reorder(listId, open, id, beforeId) {
      const choice = keyForPosition(open, id, beforeId);
      if (choice.kind === 'same') return { ok: true };
      if (choice.kind === 'missing') return { ok: false, error: 'invalid' };
      return send(listId, 'update', id, { orderKey: choice.key });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
