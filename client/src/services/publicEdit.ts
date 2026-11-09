/**
 * Editing somebody else's public list (docs/v1/PRD.md FR-33, docs/notes/PRD.md FR-107).
 * Every change is one operation, built with this device's clock and **queued** on the device
 * (`publicOutbox`); the sync engine sends it to the list's restricted push as soon as the
 * server can be reached, where it is applied like a normal push, but to the owner's data.
 */
import { newId, syncOpSchema, type TodoPatch } from '@todoness/shared';
import { nextHlc } from '../data/clock';
import type { TodonessDB } from '../data/db';
import { keyForPosition, keyOnTop, type Keyed } from '../data/order';

/** Queued (`ok`), or not a valid change. What the server says comes later (dead letter). */
export type EditResult = { ok: true } | { ok: false; error: 'invalid' };

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
}

/** Validates an operation and adds it to the public queue of its target. */
export async function queuePublicOp(
  db: TodonessDB,
  now: () => number,
  target: { target: 'list' | 'note'; targetId: string },
  op: { entity: 'todo' | 'note'; type: string; entityId: string; patch: Record<string, unknown> },
): Promise<EditResult> {
  return db.transaction('rw', [db.publicOutbox, db.meta], async () => {
    const parsed = syncOpSchema.safeParse({
      opId: newId(now()),
      ...op,
      hlc: await nextHlc(db, now),
    });
    if (!parsed.success) return { ok: false, error: 'invalid' } as const;
    await db.publicOutbox.add({ ...parsed.data, ...target, attempts: 0, createdAt: now() });
    return { ok: true } as const;
  });
}

export function createPublicEditor(deps: { db: TodonessDB; now?: () => number }): PublicEditor {
  const { db, now = Date.now } = deps;

  const send = (
    listId: string,
    type: 'create' | 'update' | 'delete' | 'restore',
    entityId: string,
    patch: Record<string, unknown>,
  ) =>
    queuePublicOp(
      db,
      now,
      { target: 'list', targetId: listId },
      {
        entity: 'todo',
        type,
        entityId,
        patch,
      },
    );

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
  };
}
