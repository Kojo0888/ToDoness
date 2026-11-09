/**
 * What a public list or the public notes look like with this device's queued changes on top
 * of the last copy from the server (docs/notes/PRD.md FR-107, decision N9). Pure functions.
 */
import {
  hlcWall,
  type PublicListResponse,
  type PublicNote,
  type PublicTodo,
} from '@todoness/shared';
import type { PublicOp } from './db';

/** Task fields a public page shows; anything else in a patch is ignored here. */
const TODO_FIELDS = ['title', 'notes', 'done', 'completedAt', 'dueAt', 'priority', 'orderKey'];

const byClock = (ops: readonly PublicOp[]) =>
  [...ops].sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0));

function pick(patch: Readonly<Record<string, unknown>>): Partial<PublicTodo> {
  const out: Record<string, unknown> = {};
  for (const k of TODO_FIELDS) if (patch[k] !== undefined) out[k] = patch[k];
  return out as Partial<PublicTodo>;
}

export function overlayListPage(
  page: PublicListResponse,
  ops: readonly PublicOp[],
): PublicListResponse {
  const live = new Map(page.todos.map((t) => [t.id, t]));
  const hidden = new Map<string, PublicTodo>();

  for (const op of byClock(ops)) {
    if (op.target !== 'list' || op.targetId !== page.list.id || op.entity !== 'todo') continue;
    const current = live.get(op.entityId);
    switch (op.type) {
      case 'create':
      case 'update': {
        if (current) live.set(op.entityId, { ...current, ...pick(op.patch) });
        else if (op.type === 'create') {
          live.set(op.entityId, {
            id: op.entityId,
            title: '',
            notes: '',
            done: false,
            completedAt: null,
            dueAt: null,
            priority: 0,
            orderKey: '',
            attachments: [],
            ...pick(op.patch),
          });
        } else {
          const gone = hidden.get(op.entityId);
          if (gone) hidden.set(op.entityId, { ...gone, ...pick(op.patch) });
        }
        break;
      }
      case 'delete':
        if (current) {
          hidden.set(op.entityId, current);
          live.delete(op.entityId);
        }
        break;
      case 'restore': {
        const gone = hidden.get(op.entityId);
        if (gone) {
          live.set(op.entityId, gone);
          hidden.delete(op.entityId);
        }
        break;
      }
    }
  }

  // The server's order: by key, then by id.
  const todos = [...live.values()].sort((a, b) =>
    a.orderKey !== b.orderKey ? (a.orderKey < b.orderKey ? -1 : 1) : a.id < b.id ? -1 : 1,
  );
  return { ...page, todos };
}

/** Public notes with their queued text changes; the order stays (no jumping while typing). */
export function overlayNotes(notes: readonly PublicNote[], ops: readonly PublicOp[]): PublicNote[] {
  const byId = new Map(notes.map((n) => [n.id, { ...n }]));
  for (const op of byClock(ops)) {
    if (op.target !== 'note' || op.entity !== 'note' || op.type !== 'update') continue;
    const note = byId.get(op.entityId);
    const text = op.patch.text;
    if (!note || typeof text !== 'string') continue;
    note.text = text;
    note.updatedAt = Math.max(note.updatedAt, hlcWall(op.hlc));
  }
  return notes.map((n) => byId.get(n.id)!);
}
