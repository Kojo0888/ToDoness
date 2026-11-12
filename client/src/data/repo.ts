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
  ACTIVITY_LINKS_MAX,
  addDays,
  applyOp,
  dayNumber,
  earliestStart,
  ignoredLinks,
  liveLinks,
  localDay,
  newId,
  normalizeRemindBefore,
  schedulePlan,
  syncOpSchema,
  wouldLoop,
  type Activity,
  type Entity,
  type List,
  type ListModule,
  type Note,
  type OpType,
  type Plan,
  type Todo,
  type TodoPatch,
} from '@todoness/shared';
import { nextHlc as nextHlcOf } from './clock';
import type { TodonessDB } from './db';
import { keyForPosition } from './order';
import { sameLinks, type ActivityChange } from '../lib/planUndo';
import { moduleOf, noteListKey } from './queries';
import type { RecoverySnapshot, RestoreMode } from './recovery';

export type RepoErrorCode = 'invalid' | 'not_found' | 'inbox_protected' | 'loop' | 'limit';

export interface ActivityEdit {
  name?: string;
  start?: string;
  days?: number;
}

/** How long a new activity lasts (docs/plan/PRD.md FR-124). */
export const NEW_ACTIVITY_DAYS = 3;

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
  /** A new plan with this name, after the existing ones. */
  createPlan(name: string): Promise<Plan>;
  renamePlan(id: string, name: string): Promise<Plan>;
  /** Puts a plan directly before another one (`null` = at the end), for drag and drop. */
  reorderPlan(id: string, beforeId: string | null): Promise<Plan>;
  /** Deletes a plan and its activities. */
  deletePlan(id: string): Promise<Plan>;
  /**
   * A new activity in the bottom row: it starts the day after the latest end in the plan
   * (today in an empty plan) and lasts `NEW_ACTIVITY_DAYS`.
   */
  createActivity(planId: string, name: string): Promise<Activity>;
  /**
   * Changes the name, the start day or the duration. A start before the end of a
   * predecessor becomes the first allowed day, and when the start or the duration changes,
   * activities are pushed later where a dependency needs it, in the same transaction
   * (docs/plan/PRD.md FR-136). A rename alone moves nothing.
   */
  updateActivity(
    id: string,
    /** The new values, or a function that works them out from the stored activity. */
    patch: ActivityEdit | ((current: Activity) => ActivityEdit),
  ): Promise<Activity>;
  deleteActivity(id: string): Promise<Activity>;
  restoreActivity(id: string): Promise<Activity>;
  /**
   * Makes `toId` depend on `fromId` (it starts after `fromId` has ended) and pushes it later
   * where needed. Returns `toId`'s activity. Errors: `loop` (the link would close a loop, or
   * both are the same activity), `invalid` (different plans), `limit` (it already depends on
   * `ACTIVITY_LINKS_MAX` activities). "Already linked" goes by the links that count
   * (`liveLinks`), not by what is stored.
   */
  linkActivities(fromId: string, toId: string): Promise<Activity>;
  /**
   * Removes that dependency. Nothing moves. Stored links of the plan that do not count
   * because they close a loop (left by a merge) are removed with it, so that none of them
   * turns into an arrow by itself.
   */
  unlinkActivities(fromId: string, toId: string): Promise<Activity>;
  /**
   * Undo (docs/plan/PRD.md FR-147): takes back what a change did (lib/planUndo.ts). A field
   * gets its earlier value only while it still has the value the change gave it, so edits
   * made since, here or on another device, are never overwritten. Activities deleted
   * meanwhile are skipped; nothing is shifted.
   */
  revertActivities(changes: readonly ActivityChange[]): Promise<void>;
  /**
   * Puts the data of another account (kept aside at sign-up) into this one, as normal queued
   * changes. `append` keeps what is here; `overwrite` deletes the live tasks, lists (never
   * the Inbox) and notes first. Rows keep their ids, so doing it twice merges. Tasks of the
   * old Inbox go to this account's Inbox.
   */
  restoreSnapshot(
    snapshot: RecoverySnapshot,
    mode: RestoreMode,
  ): Promise<{ lists: number; todos: number; notes: number; plans: number }>;
}

export function createRepo(db: TodonessDB, opts: { now?: () => number } = {}): Repo {
  const now = opts.now ?? Date.now;

  const inTx = <T>(fn: () => Promise<T>) =>
    db.transaction(
      'rw',
      [db.todos, db.lists, db.notes, db.plans, db.activities, db.outbox, db.meta],
      fn,
    );

  type AnyRow = Todo | List | Note | Plan | Activity;
  const tableOf = <T extends AnyRow>(entity: Entity) =>
    (
      ({
        todo: db.todos,
        list: db.lists,
        note: db.notes,
        plan: db.plans,
        activity: db.activities,
      }) as const
    )[entity] as unknown as Dexie.Table<T, string>;

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

  async function livePlan(id: string): Promise<Plan> {
    const p = await db.plans.get(id);
    if (!p || p.deletedAt !== null) throw new RepoError('not_found', 'Plan not found');
    return p;
  }

  async function liveActivity(id: string): Promise<Activity> {
    const a = await db.activities.get(id);
    if (!a || a.deletedAt !== null) throw new RepoError('not_found', 'Activity not found');
    return a;
  }

  const rowsOfPlan = (planId: string) =>
    db.activities
      .where('[planId+orderKey]')
      .between([planId, Dexie.minKey], [planId, Dexie.maxKey]);

  /** Activities of a plan that are not deleted, in row order. */
  async function activitiesOfPlan(planId: string): Promise<Activity[]> {
    return (await rowsOfPlan(planId).toArray()).filter((a) => a.deletedAt === null);
  }

  /** Pushes activities later until every dependency of the plan holds again (FR-136). */
  async function reschedule(planId: string): Promise<void> {
    for (const [id, start] of schedulePlan(await activitiesOfPlan(planId))) {
      await commit<Activity>('activity', 'update', id, { start });
    }
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
    const lists = await db.lists.toArray();
    const key = noteListKey(lists);
    const myNotes = lists.find((l) => l.deletedAt === null && l.isInbox && moduleOf(l) === 'notes');
    const own = listId === myNotes?.id ? null : listId;
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

    createPlan: (name) =>
      inTx(async () => {
        const last = await db.plans.orderBy('orderKey').last();
        return commit<Plan>('plan', 'create', newId(now()), {
          name,
          orderKey: generateKeyBetween(last?.orderKey ?? null, null),
        });
      }),

    renamePlan: (id, name) =>
      inTx(async () => {
        const plan = await livePlan(id);
        if (plan.name === name.trim()) return plan;
        return commit<Plan>('plan', 'update', id, { name });
      }),

    reorderPlan: (id, beforeId) =>
      inTx(async () => {
        const plan = await livePlan(id);
        const live = (await db.plans.orderBy('orderKey').toArray()).filter(
          (p) => p.deletedAt === null,
        );
        const choice = keyForPosition(live, id, beforeId);
        if (choice.kind === 'same') return plan;
        if (choice.kind === 'missing') throw new RepoError('not_found', 'Plan or target not found');
        return commit<Plan>('plan', 'update', id, { orderKey: choice.key });
      }),

    deletePlan: (id) =>
      inTx(async () => {
        const plan = await db.plans.get(id);
        if (!plan) throw new RepoError('not_found', 'Plan not found');
        if (plan.deletedAt !== null) return plan;
        for (const a of await activitiesOfPlan(id)) {
          await commit<Activity>('activity', 'delete', a.id, {});
        }
        return commit<Plan>('plan', 'delete', id, {});
      }),

    createActivity: (planId, name) =>
      inTx(async () => {
        await livePlan(planId);
        const live = await activitiesOfPlan(planId);
        const free = live.map((a) => dayNumber(a.start) + a.days);
        const today = localDay(now());
        const last = await rowsOfPlan(planId).last(); // deleted rows keep their place
        return commit<Activity>('activity', 'create', newId(now()), {
          planId,
          name,
          start: free.length > 0 ? addDays('1970-01-01', Math.max(...free)) : today,
          days: NEW_ACTIVITY_DAYS,
          orderKey: generateKeyBetween(last?.orderKey ?? null, null),
        });
      }),

    updateActivity: (id, edit) =>
      inTx(async () => {
        const activity = await liveActivity(id);
        const patch = typeof edit === 'function' ? edit(activity) : edit;
        const changes: Record<string, unknown> = {};
        if (patch.name !== undefined && patch.name.trim() !== activity.name) {
          changes.name = patch.name;
        }
        if (patch.days !== undefined && patch.days !== activity.days) changes.days = patch.days;
        if (patch.start !== undefined) {
          // Not before its predecessors have ended (days compare as text).
          const earliest = earliestStart(await activitiesOfPlan(activity.planId), id);
          const start = earliest !== null && patch.start < earliest ? earliest : patch.start;
          if (start !== activity.start) changes.start = start;
        }
        if (Object.keys(changes).length === 0) return activity;
        const saved = await commit<Activity>('activity', 'update', id, changes);
        // A rename must not move anything (and has no undo point): only dates do.
        if (!('start' in changes) && !('days' in changes)) return saved;
        await reschedule(activity.planId);
        return liveActivity(id);
      }),

    deleteActivity: (id) =>
      inTx(async () => {
        const activity = await db.activities.get(id);
        if (!activity) throw new RepoError('not_found', 'Activity not found');
        if (activity.deletedAt !== null) return activity;
        return commit<Activity>('activity', 'delete', id, {});
      }),

    restoreActivity: (id) =>
      inTx(async () => {
        const activity = await db.activities.get(id);
        if (!activity) throw new RepoError('not_found', 'Activity not found');
        if (activity.deletedAt === null) return activity;
        await commit<Activity>('activity', 'restore', id, {});
        await reschedule(activity.planId); // its links count again
        return liveActivity(id);
      }),

    linkActivities: (fromId, toId) =>
      inTx(async () => {
        if (fromId === toId) throw new RepoError('loop', 'An activity cannot depend on itself');
        const from = await liveActivity(fromId);
        const to = await liveActivity(toId);
        if (from.planId !== to.planId) {
          throw new RepoError('invalid', 'Activities of different plans cannot be linked');
        }
        const all = await activitiesOfPlan(to.planId);
        if (liveLinks(all).some((l) => l.from === fromId && l.to === toId)) return to;
        if (wouldLoop(all, fromId, toId)) {
          throw new RepoError('loop', 'The link would close a loop');
        }
        let dependsOn = to.dependsOn.filter((id) => id !== fromId);
        if (dependsOn.length >= ACTIVITY_LINKS_MAX) {
          // Ids of deleted (or unknown) activities must not use up the limit.
          const live = new Set(all.map((a) => a.id));
          dependsOn = dependsOn.filter((id) => live.has(id));
        }
        if (dependsOn.length >= ACTIVITY_LINKS_MAX) {
          throw new RepoError('limit', 'An activity cannot depend on more activities');
        }
        await commit<Activity>('activity', 'update', toId, { dependsOn: [...dependsOn, fromId] });
        await reschedule(to.planId);
        return liveActivity(toId);
      }),

    unlinkActivities: (fromId, toId) =>
      inTx(async () => {
        const to = await liveActivity(toId);
        if (!to.dependsOn.includes(fromId)) return to;
        // What goes: this link and the plan's stored links that do not count.
        const drop = new Map<string, Set<string>>([[toId, new Set([fromId])]]);
        for (const l of ignoredLinks(await activitiesOfPlan(to.planId))) {
          drop.set(l.to, (drop.get(l.to) ?? new Set()).add(l.from));
        }
        for (const [id, gone] of drop) {
          const activity = id === toId ? to : await liveActivity(id);
          await commit<Activity>('activity', 'update', id, {
            dependsOn: activity.dependsOn.filter((from) => !gone.has(from)),
          });
        }
        return liveActivity(toId);
      }),

    revertActivities: (changes) =>
      inTx(async () => {
        for (const { id, before, after } of changes) {
          const now = await db.activities.get(id);
          if (!now || now.deletedAt !== null) continue;
          // Only fields that still hold what the change wrote: nothing newer is lost.
          const patch: Record<string, unknown> = {};
          if (before.start !== undefined && now.start === after.start) patch.start = before.start;
          if (before.days !== undefined && now.days === after.days) patch.days = before.days;
          if (
            before.dependsOn !== undefined &&
            after.dependsOn !== undefined &&
            sameLinks(now.dependsOn, after.dependsOn)
          ) {
            patch.dependsOn = before.dependsOn;
          }
          if (Object.keys(patch).length > 0)
            await commit<Activity>('activity', 'update', id, patch);
        }
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
          for (const a of await db.activities.toArray()) {
            if (a.deletedAt === null) await commit<Activity>('activity', 'delete', a.id, {});
          }
          for (const p of await db.plans.toArray()) {
            if (p.deletedAt === null) await commit<Plan>('plan', 'delete', p.id, {});
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
        const plans = snapshot.plans ?? []; // missing in a copy kept before the Plan module
        const planIds = new Set(plans.map((p) => p.id));
        for (const p of plans) {
          await put<Plan>('plan', p.id, { name: p.name, orderKey: p.orderKey });
        }
        for (const a of snapshot.activities ?? []) {
          if (!planIds.has(a.planId)) continue;
          await put<Activity>('activity', a.id, {
            planId: a.planId,
            name: a.name,
            start: a.start,
            days: a.days,
            dependsOn: a.dependsOn,
            orderKey: a.orderKey,
          });
        }
        return {
          lists: snapshot.lists.length,
          todos: snapshot.todos.length,
          notes: notes.length,
          plans: plans.length,
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
