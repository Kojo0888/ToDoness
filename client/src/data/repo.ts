/**
 * The only code that changes data (docs/mvp/MVPImplementationSteps.md, Step 2).
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
  applyOp,
  newId,
  normalizeRemindBefore,
  syncOpSchema,
  type Entity,
  type List,
  type ListModule,
  type Note,
  type OpType,
  type Todo,
  type TodoPatch,
} from '@todoness/shared';
import { nextHlc as nextHlcOf } from './clock';
import type { TodonessDB } from './db';
import { keyForPosition } from './order';
import { moduleOf } from './queries';
import type { RecoverySnapshot, RestoreMode } from './recovery';

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
  /** A new list at the end of its module's lists (`tasks` unless said otherwise). */
  createList(name: string, module?: ListModule): Promise<List>;
  renameList(id: string, name: string): Promise<List>;
  deleteList(id: string): Promise<List>;
  /**
   * Puts a task directly before another open task of the same list (`null` = at the
   * end). One `orderKey` update; nothing happens if the position would not change.
   */
  reorderTodo(id: string, beforeId: string | null): Promise<Todo>;
  /** Makes a list readable (or not) by every logged-in user. */
  setListPublic(id: string, isPublic: boolean): Promise<List>;
  /**
   * Puts a list directly before another one (`null` = at the end), for drag and drop. One
   * `orderKey` update; nothing happens if the position would not change. The Inbox stays
   * first: it cannot be moved, and nothing can be put before it.
   */
  reorderList(id: string, beforeId: string | null): Promise<List>;
  /**
   * A new note with this text, on top of its note list (`null` = My notes). Blank text is
   * refused.
   */
  createNote(text: string, listId?: string | null): Promise<Note>;
  /** Replaces the text of a note (it may become empty). */
  updateNoteText(id: string, text: string): Promise<Note>;
  /** Makes a note readable and editable (or not) by every logged-in user. */
  setNotePublic(id: string, isPublic: boolean): Promise<Note>;
  deleteNote(id: string): Promise<Note>;
  /**
   * Puts a note directly before another live note (`null` = at the end). One `orderKey`
   * update; nothing happens if the position would not change.
   */
  reorderNote(id: string, beforeId: string | null): Promise<Note>;
  restoreNote(id: string): Promise<Note>;
  /**
   * Puts the data of another account (kept aside at sign-up) into this one, as normal queued
   * changes. `append` keeps what is here; `overwrite` deletes the live tasks, lists (never
   * the Inbox) and notes first. Rows keep their ids, so doing it twice merges. Tasks of the
   * old Inbox go to this account's Inbox.
   */
  restoreSnapshot(
    snapshot: RecoverySnapshot,
    mode: RestoreMode,
  ): Promise<{ lists: number; todos: number; notes: number }>;
}

export function createRepo(db: TodonessDB, opts: { now?: () => number } = {}): Repo {
  const now = opts.now ?? Date.now;

  const inTx = <T>(fn: () => Promise<T>) =>
    db.transaction('rw', [db.todos, db.lists, db.notes, db.outbox, db.meta], fn);

  type AnyRow = Todo | List | Note;
  const tableOf = <T extends AnyRow>(entity: Entity) =>
    ({ todo: db.todos, list: db.lists, note: db.notes })[entity] as unknown as Dexie.Table<
      T,
      string
    >;

  const nextHlc = () => nextHlcOf(db, now);

  /** Validates, applies and queues one operation. Returns the resulting row. */
  async function commit<T extends AnyRow>(
    entity: Entity,
    type: OpType,
    entityId: string,
    patch: Record<string, unknown>,
  ): Promise<T> {
    const table = tableOf<T>(entity);
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

  async function liveNote(id: string): Promise<Note> {
    const n = await db.notes.get(id);
    if (!n || n.deletedAt !== null) throw new RepoError('not_found', 'Note not found');
    return n;
  }

  /** Todos of a list that are not deleted, in key order. */
  async function todosOfList(listId: string): Promise<Todo[]> {
    const rows = await db.todos
      .where('[listId+orderKey]')
      .between([listId, Dexie.minKey], [listId, Dexie.maxKey])
      .toArray();
    return rows.filter((t) => t.deletedAt === null);
  }

  /** Live notes of a note list (`null` = My notes, also by its id), in key order. */
  async function notesOfList(listId: string | null): Promise<Note[]> {
    const myNotes = (await db.lists.toArray()).find(
      (l) => l.deletedAt === null && l.isInbox && moduleOf(l) === 'notes',
    )?.id;
    const key = (n: Note) => (n.listId == null || n.listId === myNotes ? null : n.listId);
    const own = listId === myNotes ? null : listId;
    return (await db.notes.orderBy('orderKey').toArray()).filter(
      (n) => n.deletedAt === null && key(n) === own,
    );
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

    reorderTodo: (id, beforeId) =>
      inTx(async () => {
        const todo = await liveTodo(id);
        const open = (await todosOfList(todo.listId)).filter((t) => !t.done);
        const choice = keyForPosition(open, id, beforeId);
        if (choice.kind === 'same') return todo;
        if (choice.kind === 'missing') throw new RepoError('not_found', 'Task or target not found');
        return commit<Todo>('todo', 'update', id, { orderKey: choice.key });
      }),

    createNote: (text, listId = null) =>
      inTx(async () => {
        if (!text.trim()) throw new RepoError('invalid', 'A new note needs text');
        if (listId !== null) {
          const list = await liveList(listId);
          if (moduleOf(list) !== 'notes') throw new RepoError('not_found', 'Not a note list');
        }
        const first = (await notesOfList(listId))[0];
        const patch: Record<string, unknown> = {
          text,
          orderKey: generateKeyBetween(null, first?.orderKey ?? null),
        };
        if (listId !== null) patch.listId = listId; // My notes: as older apps write it
        return commit<Note>('note', 'create', newId(now()), patch);
      }),

    updateNoteText: (id, text) =>
      inTx(async () => {
        const note = await liveNote(id);
        if (note.text === text) return note;
        return commit<Note>('note', 'update', id, { text });
      }),

    setNotePublic: (id, isPublic) =>
      inTx(async () => {
        const note = await liveNote(id);
        if (note.isPublic === isPublic) return note;
        return commit<Note>('note', 'update', id, { isPublic });
      }),

    reorderNote: (id, beforeId) =>
      inTx(async () => {
        const note = await liveNote(id);
        const live = await notesOfList(note.listId ?? null);
        const choice = keyForPosition(live, id, beforeId);
        if (choice.kind === 'same') return note;
        if (choice.kind === 'missing') throw new RepoError('not_found', 'Note or target not found');
        return commit<Note>('note', 'update', id, { orderKey: choice.key });
      }),

    deleteNote: (id) =>
      inTx(async () => {
        const note = await db.notes.get(id);
        if (!note) throw new RepoError('not_found', 'Note not found');
        if (note.deletedAt !== null) return note;
        return commit<Note>('note', 'delete', id, {});
      }),

    restoreNote: (id) =>
      inTx(async () => {
        const note = await db.notes.get(id);
        if (!note) throw new RepoError('not_found', 'Note not found');
        if (note.deletedAt === null) return note;
        return commit<Note>('note', 'restore', id, {});
      }),

    setListPublic: (id, isPublic) =>
      inTx(async () => {
        const list = await liveList(id);
        if (list.isPublic === isPublic) return list;
        return commit<List>('list', 'update', id, { isPublic });
      }),

    createList: (name, module = 'tasks') =>
      inTx(async () => {
        const last = await db.lists.orderBy('orderKey').last();
        const patch: Record<string, unknown> = {
          name,
          orderKey: generateKeyBetween(last?.orderKey ?? null, null),
        };
        if (module !== 'tasks') patch.module = module; // task lists: as before note lists
        return commit<List>('list', 'create', newId(now()), patch);
      }),

    renameList: (id, name) =>
      inTx(async () => {
        const list = await liveList(id);
        // "My notes" may be renamed (docs/note-lists FR-129); the task Inbox may not.
        if (list.isInbox && moduleOf(list) === 'tasks') {
          throw new RepoError('inbox_protected', 'The Inbox cannot be renamed');
        }
        return commit<List>('list', 'update', id, { name });
      }),

    reorderList: (id, beforeId) =>
      inTx(async () => {
        const list = await liveList(id);
        if (list.isInbox) throw new RepoError('inbox_protected', 'The Inbox cannot be moved');
        if (beforeId !== null) {
          const target = await liveList(beforeId);
          if (target.isInbox) {
            throw new RepoError('inbox_protected', 'Nothing can be put above the Inbox');
          }
        }
        // Among the lists of the same module (task lists and note lists are ordered apart).
        const live = (await db.lists.orderBy('orderKey').toArray()).filter(
          (l) => l.deletedAt === null && moduleOf(l) === moduleOf(list),
        );
        const choice = keyForPosition(live, id, beforeId);
        if (choice.kind === 'same') return list;
        if (choice.kind === 'missing') throw new RepoError('not_found', 'List or target not found');
        return commit<List>('list', 'update', id, { orderKey: choice.key });
      }),

    restoreSnapshot: (snapshot, mode) =>
      inTx(async () => {
        const inbox = (await db.lists.toArray()).find(
          (l) => l.isInbox && l.deletedAt === null && moduleOf(l) === 'tasks',
        );
        if (!inbox) throw new RepoError('not_found', 'The Inbox is not here yet');

        if (mode === 'overwrite') {
          for (const t of await db.todos.toArray()) {
            if (t.deletedAt === null) await commit<Todo>('todo', 'delete', t.id, {});
          }
          for (const l of await db.lists.toArray()) {
            if (l.deletedAt === null && !l.isInbox) await commit<List>('list', 'delete', l.id, {});
          }
          for (const n of await db.notes.toArray()) {
            if (n.deletedAt === null) await commit<Note>('note', 'delete', n.id, {});
          }
        }

        /** Creates the row, or merges into the one that is already here; undeletes it. */
        async function put<T extends AnyRow>(
          entity: Entity,
          id: string,
          patch: Record<string, unknown>,
        ) {
          const existing = await tableOf<T>(entity).get(id);
          await commit<T>(entity, 'create', id, patch);
          if (existing && existing.deletedAt !== null) await commit<T>(entity, 'restore', id, {});
        }

        const taskListIds = new Set(
          snapshot.lists.filter((l) => moduleOf(l) === 'tasks').map((l) => l.id),
        );
        const noteListIds = new Set(
          snapshot.lists.filter((l) => moduleOf(l) === 'notes').map((l) => l.id),
        );
        for (const l of snapshot.lists) {
          const patch: Record<string, unknown> = {
            name: l.name,
            orderKey: l.orderKey,
            isPublic: l.isPublic,
          };
          if (moduleOf(l) !== 'tasks') patch.module = moduleOf(l);
          await put<List>('list', l.id, patch);
        }
        for (const t of snapshot.todos) {
          await put<Todo>('todo', t.id, {
            listId: taskListIds.has(t.listId) ? t.listId : inbox.id,
            title: t.title,
            orderKey: t.orderKey,
            notes: t.notes,
            done: t.done,
            completedAt: t.completedAt,
            dueAt: t.dueAt,
            priority: t.priority,
            remindBefore: normalizeRemindBefore(t.remindBefore), // older copies: one value
          });
        }
        const notes = snapshot.notes ?? []; // missing in a copy kept before notes existed
        for (const n of notes) {
          const patch: Record<string, unknown> = {
            text: n.text,
            orderKey: n.orderKey,
            isPublic: n.isPublic,
          };
          // Notes of the old "My notes" (or of a list not kept) go to this account's My notes.
          if (n.listId != null && noteListIds.has(n.listId)) patch.listId = n.listId;
          await put<Note>('note', n.id, patch);
        }
        return {
          lists: snapshot.lists.length,
          todos: snapshot.todos.length,
          notes: notes.length,
        };
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
        // A note list takes its notes with it (docs/note-lists FR-128).
        for (const n of await db.notes.toArray()) {
          if (n.listId === id && n.deletedAt === null) {
            await commit<Note>('note', 'delete', n.id, {});
          }
        }
        return commit<List>('list', 'delete', id, {});
      }),
  };
}
