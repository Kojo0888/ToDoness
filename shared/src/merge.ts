/**
 * Applying a change to a row (see DBModel.md section 3.2, rules 2–4).
 *
 * Used by the server for pushed operations and by the client for pulled
 * changes, so both sides reach the same result.
 *
 * Rules:
 *  - Per-field "last write wins": a field takes the new value only if the
 *    operation's HLC is newer than the HLC stored for that field.
 *  - Applying the same operation again changes nothing (equal HLC is not newer).
 *  - `delete` / `restore` are writes to the `deletedAt` field, so the newer one
 *    wins. Edits never touch `deletedAt`, so an edit cannot undelete a row.
 *  - A `create` for a row that already exists is merged like an update.
 *  - The input row is never modified; a new object is returned.
 */
import { compareHlc, hlcWall, type Hlc } from './hlc';
import type { Activity, Entity, List, Note, OpType, Plan, Todo } from './schemas';

export interface ApplyInput {
  entity: Entity;
  entityId: string;
  type: OpType;
  patch: Readonly<Record<string, unknown>>;
  hlc: Hlc;
}

export type ApplyResult<T> =
  | { ok: true; row: T; accepted: Record<string, unknown>; changed: boolean }
  | { ok: false; reason: 'not_found' | 'missing_fields' };

type Row = Todo | List | Note | Plan | Activity;

const TODO_DEFAULTS = {
  notes: '',
  done: false,
  completedAt: null,
  dueAt: null,
  priority: 0,
  remindBefore: [] as Todo['remindBefore'],
  deletedAt: null,
} as const satisfies Partial<Todo>;

const LIST_DEFAULTS = {
  isInbox: false,
  module: 'tasks',
  isPublic: false,
  deletedAt: null,
} as const satisfies Partial<List>;

const NOTE_DEFAULTS = {
  text: '',
  listId: null,
  isPublic: false,
  deletedAt: null,
} as const satisfies Partial<Note>;

const PLAN_DEFAULTS = { deletedAt: null } as const satisfies Partial<Plan>;

const ACTIVITY_DEFAULTS = {
  days: 1,
  dependsOn: [] as string[],
  done: false,
  parentId: null,
  deletedAt: null,
} as const satisfies Partial<Activity>;

const DEFAULTS: Record<Entity, object> = {
  todo: TODO_DEFAULTS,
  list: LIST_DEFAULTS,
  note: NOTE_DEFAULTS,
  plan: PLAN_DEFAULTS,
  activity: ACTIVITY_DEFAULTS,
};

const REQUIRED_ON_CREATE: Record<Entity, readonly string[]> = {
  todo: ['listId', 'title', 'orderKey'],
  list: ['name', 'orderKey'],
  note: ['orderKey'],
  plan: ['name', 'orderKey'],
  activity: ['planId', 'name', 'start', 'orderKey'],
};

/** Fields that bookkeeping owns; a patch can never set them directly. */
const PROTECTED = new Set(['id', 'fieldHlc', 'createdAt', 'updatedAt']);

/** Turns an operation into the field values it writes. */
function fieldsOf(input: ApplyInput): Record<string, unknown> {
  switch (input.type) {
    case 'delete':
      return { deletedAt: hlcWall(input.hlc) };
    case 'restore':
      return { deletedAt: null };
    default:
      return input.patch;
  }
}

function newRow(input: ApplyInput): Row {
  const wall = hlcWall(input.hlc);
  const base = { id: input.entityId, fieldHlc: {}, createdAt: wall, updatedAt: wall };
  return { ...DEFAULTS[input.entity], ...base } as Row;
}

export function applyOp<T extends Row>(row: T | undefined, input: ApplyInput): ApplyResult<T> {
  const fields = fieldsOf(input);
  let current: Row;
  let created = false;

  if (row === undefined) {
    if (input.type !== 'create') return { ok: false, reason: 'not_found' };
    if (!REQUIRED_ON_CREATE[input.entity].every((f) => fields[f] !== undefined)) {
      return { ok: false, reason: 'missing_fields' };
    }
    current = newRow(input);
    created = true;
  } else {
    current = row;
  }

  const next: Record<string, unknown> = { ...current, fieldHlc: { ...current.fieldHlc } };
  const fieldHlc = next.fieldHlc as Record<string, Hlc>;
  const accepted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || PROTECTED.has(key)) continue;
    const previous = fieldHlc[key];
    if (previous !== undefined && compareHlc(input.hlc, previous) <= 0) continue;
    next[key] = value;
    fieldHlc[key] = input.hlc;
    accepted[key] = value;
  }

  const changed = created || Object.keys(accepted).length > 0;
  if (!changed) return { ok: true, row: row as T, accepted, changed: false };

  next.updatedAt = Math.max(current.updatedAt, hlcWall(input.hlc));
  return { ok: true, row: next as T, accepted, changed: true };
}
