/**
 * Data shapes shared by client and server (see DBModel.md sections 4 and 5).
 *
 * Patch schemas are strict: they are the whitelist of fields a client may
 * change. Any other field (userId, fieldHlc, deletedAt, isInbox, …) makes the
 * operation invalid.
 */
import { z } from 'zod';
import { isHlc, isValidClientId } from './hlc';
import { EVENT_REMINDS, REPEATS, isTime, isTimeZone, normalizeEventReminds } from './calendar';
import { isDay } from './plan';

export const TITLE_MAX = 500;
export const NOTES_MAX = 10_000;
export const LIST_NAME_MAX = 200;
export const NOTE_TEXT_MAX = 20_000;
export const ORDER_KEY_MAX = 200;
export const PLAN_NAME_MAX = 200;
export const ACTIVITY_NAME_MAX = 200;
/** The longest activity: ten years. */
export const ACTIVITY_DAYS_MAX = 3660;
/** How many activities one activity can depend on. */
export const ACTIVITY_LINKS_MAX = 50;
export const CALENDAR_NAME_MAX = 200;
export const EVENT_TITLE_MAX = 200;
export const EVENT_PLACE_MAX = 200;
/** The longest description of an event (docs/calendar/PRD.md FR-246). */
export const EVENT_DESCRIPTION_MAX = 5000;
/** The longest all-day event: a year (docs/calendar/PRD.md FR-207). */
export const EVENT_DAYS_MAX = 366;
export const PUSH_BATCH_MAX = 500;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export const idSchema = z.uuid();
export const hlcSchema = z.string().refine(isHlc, { message: 'Invalid HLC' });
export const clientIdSchema = z.string().refine(isValidClientId, { message: 'Invalid client id' });
const epochMs = z.number().int().min(0);
const nullableEpochMs = epochMs.nullable();
const fieldHlcSchema = z.record(z.string(), hlcSchema);
const orderKeySchema = z.string().min(1).max(ORDER_KEY_MAX);
export const remindBeforeSchema = z.enum(['week', 'day', 'hour']);
export type RemindBefore = z.infer<typeof remindBeforeSchema>;
/** The order reminders are kept and shown in: earliest first. */
export const REMIND_ORDER: readonly RemindBefore[] = remindBeforeSchema.options;

/**
 * The one rule for reading reminders from older app versions and older stored rows:
 * `null`/missing is `[]`, a single value is `[value]`. Values are not checked here.
 */
export function legacyRemindList(v: unknown): unknown[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

/** A task's reminders as a unique list in REMIND_ORDER; unknown values are dropped. */
export function normalizeRemindBefore(v: unknown): RemindBefore[] {
  const given = legacyRemindList(v);
  return REMIND_ORDER.filter((r) => given.includes(r));
}

/**
 * The single value an app from before several reminders (v1) understands: the earliest
 * chosen reminder, or null. Used when such an app pulls changes.
 */
export function toLegacyRemindBefore(list: readonly RemindBefore[]): RemindBefore | null {
  return REMIND_ORDER.find((r) => list.includes(r)) ?? null;
}

const remindListSchema = z.preprocess(
  legacyRemindList,
  z.array(remindBeforeSchema).max(10).transform(normalizeRemindBefore),
);
export const prioritySchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

const todoFields = {
  listId: idSchema,
  title: z.string().trim().min(1).max(TITLE_MAX),
  notes: z.string().max(NOTES_MAX),
  done: z.boolean(),
  completedAt: nullableEpochMs,
  dueAt: nullableEpochMs,
  priority: prioritySchema,
  remindBefore: remindListSchema,
  orderKey: orderKeySchema,
};

const listFields = {
  name: z.string().trim().min(1).max(LIST_NAME_MAX),
  orderKey: orderKeySchema,
  isPublic: z.boolean(),
};

/** Which module a list belongs to (docs/note-lists/PRD.md, decision L1). Set at creation only. */
export const listModuleSchema = z.enum(['tasks', 'notes']);
export type ListModule = z.infer<typeof listModuleSchema>;

const noteFields = {
  text: z.string().max(NOTE_TEXT_MAX),
  /** The note list; `null` = the default note list "My notes" (decision L2). */
  listId: idSchema.nullable(),
  orderKey: orderKeySchema,
  isPublic: z.boolean(),
};

const planFields = {
  name: z.string().trim().min(1).max(PLAN_NAME_MAX),
  orderKey: orderKeySchema,
};

/** A calendar day, `YYYY-MM-DD` (docs/plan/PRD.md section 5). */
export const daySchema = z.string().refine(isDay, { message: 'Invalid day' });

/**
 * Start and duration, not start and end: every combination is a valid activity, so a merge
 * of changes from two devices can never give an end before the start (decision P1).
 */
const activityFields = {
  planId: idSchema,
  name: z.string().trim().min(1).max(ACTIVITY_NAME_MAX),
  start: daySchema,
  days: z.number().int().min(1).max(ACTIVITY_DAYS_MAX),
  /** The activities that must end before this one starts (decision P3). */
  dependsOn: z.array(idSchema).max(ACTIVITY_LINKS_MAX),
  orderKey: orderKeySchema,
  /** Finished (docs/plan/PRD.md FR-153). Changes nothing in the schedule. */
  done: z.boolean(),
  /** The group this activity is part of (docs/plan/PRD.md FR-174); `null` = top level. */
  parentId: idSchema.nullable(),
};

/** The colours of a calendar: names, mapped to CSS variables by the app (decision C3). */
export const CALENDAR_COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'teal'] as const;
export const calendarColorSchema = z.enum(CALENDAR_COLORS);
export type CalendarColor = z.infer<typeof calendarColorSchema>;

const calendarFields = {
  name: z.string().trim().min(1).max(CALENDAR_NAME_MAX),
  color: calendarColorSchema,
  orderKey: orderKeySchema,
  /** Readable by every logged-in user (docs/calendar/PRD.md FR-241). */
  isPublic: z.boolean(),
};

/** A time of day, `HH:MM` in 24 hours (docs/calendar/PRD.md decision C1). */
export const timeSchema = z.string().refine(isTime, { message: 'Invalid time' });

const eventFields = {
  calendarId: idSchema,
  title: z.string().trim().min(1).max(EVENT_TITLE_MAX),
  /** The first day. */
  start: daySchema,
  /** How many days the event touches: its end date is start + days − 1 (decision C11). */
  days: z.number().int().min(1).max(EVENT_DAYS_MAX),
  /** `null` = all day. */
  startTime: timeSchema.nullable(),
  endTime: timeSchema.nullable(),
  place: z.string().trim().max(EVENT_PLACE_MAX),
  /** Free text, shown on the event page (docs/calendar/PRD.md FR-246). Not trimmed. */
  description: z.string().max(EVENT_DESCRIPTION_MAX),
  /** docs/calendar/PRD.md section 6. */
  repeat: z.enum(REPEATS),
  /** The last day an occurrence can start; `null` = forever. */
  repeatUntil: daySchema.nullable(),
  reminders: z
    .array(z.enum(EVENT_REMINDS))
    .max(EVENT_REMINDS.length)
    .transform(normalizeEventReminds),
  /** Time zone of the device that saved the event ('' = unknown, counts as UTC). */
  tz: z
    .string()
    .max(64)
    .refine((v) => v === '' || isTimeZone(v), { message: 'Invalid time zone' }),
};

const rowMeta = {
  id: idSchema,
  fieldHlc: fieldHlcSchema,
  createdAt: epochMs,
  updatedAt: epochMs,
  deletedAt: nullableEpochMs,
};

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export const todoSchema = z.object({ ...todoFields, ...rowMeta });
export type Todo = z.infer<typeof todoSchema>;

export const listSchema = z.object({
  ...listFields,
  isInbox: z.boolean(),
  module: listModuleSchema,
  ...rowMeta,
});
export type List = z.infer<typeof listSchema>;

/** A note: a simple text box (docs/notes/PRD.md). */
export const noteSchema = z.object({ ...noteFields, ...rowMeta });
export type Note = z.infer<typeof noteSchema>;

/** A plan: a timeline of activities (docs/plan/PRD.md). */
export const planSchema = z.object({ ...planFields, ...rowMeta });
export type Plan = z.infer<typeof planSchema>;

export const activitySchema = z.object({ ...activityFields, ...rowMeta });
export type Activity = z.infer<typeof activitySchema>;

/** A calendar: a named, coloured set of events (docs/calendar/PRD.md). */
export const calendarSchema = z.object({ ...calendarFields, ...rowMeta });
export type Calendar = z.infer<typeof calendarSchema>;

export const eventSchema = z.object({ ...eventFields, ...rowMeta });
export type CalendarEvent = z.infer<typeof eventSchema>;

export type Entity = 'todo' | 'list' | 'note' | 'plan' | 'activity' | 'calendar' | 'event';
export type OpType = 'create' | 'update' | 'delete' | 'restore';

// ---------------------------------------------------------------------------
// Patches the client may send
// ---------------------------------------------------------------------------

const notEmpty = (p: object) => Object.keys(p).length > 0;
const NOT_EMPTY = { message: 'Patch must change at least one field' };

export const todoCreatePatchSchema = z.strictObject({
  listId: todoFields.listId,
  title: todoFields.title,
  orderKey: todoFields.orderKey,
  notes: todoFields.notes.optional(),
  done: todoFields.done.optional(),
  completedAt: todoFields.completedAt.optional(),
  dueAt: todoFields.dueAt.optional(),
  priority: todoFields.priority.optional(),
  remindBefore: todoFields.remindBefore.optional(),
});
export const todoUpdatePatchSchema = z
  .strictObject(todoFields)
  .partial()
  .refine(notEmpty, NOT_EMPTY);
export type TodoPatch = z.infer<typeof todoUpdatePatchSchema>;

export const listCreatePatchSchema = z.strictObject({
  ...listFields,
  isPublic: listFields.isPublic.optional(),
  module: listModuleSchema.optional(),
});
export const listUpdatePatchSchema = z
  .strictObject(listFields)
  .partial()
  .refine(notEmpty, NOT_EMPTY);
export type ListPatch = z.infer<typeof listUpdatePatchSchema>;

export const noteCreatePatchSchema = z.strictObject({
  orderKey: noteFields.orderKey,
  text: noteFields.text.optional(),
  isPublic: noteFields.isPublic.optional(),
  listId: noteFields.listId.optional(),
});
export const noteUpdatePatchSchema = z
  .strictObject(noteFields)
  .partial()
  .refine(notEmpty, NOT_EMPTY);
export type NotePatch = z.infer<typeof noteUpdatePatchSchema>;

export const planCreatePatchSchema = z.strictObject(planFields);
export const planUpdatePatchSchema = z
  .strictObject(planFields)
  .partial()
  .refine(notEmpty, NOT_EMPTY);
export type PlanPatch = z.infer<typeof planUpdatePatchSchema>;

export const activityCreatePatchSchema = z.strictObject({
  ...activityFields,
  days: activityFields.days.optional(),
  dependsOn: activityFields.dependsOn.optional(),
  done: activityFields.done.optional(),
  parentId: activityFields.parentId.optional(),
});
export const activityUpdatePatchSchema = z
  .strictObject(activityFields)
  .partial()
  .refine(notEmpty, NOT_EMPTY);
export type ActivityPatch = z.infer<typeof activityUpdatePatchSchema>;

export const calendarCreatePatchSchema = z.strictObject({
  ...calendarFields,
  color: calendarFields.color.optional(),
  isPublic: calendarFields.isPublic.optional(),
});
export const calendarUpdatePatchSchema = z
  .strictObject(calendarFields)
  .partial()
  .refine(notEmpty, NOT_EMPTY);
export type CalendarPatch = z.infer<typeof calendarUpdatePatchSchema>;

export const eventCreatePatchSchema = z.strictObject({
  ...eventFields,
  days: eventFields.days.optional(),
  startTime: eventFields.startTime.optional(),
  endTime: eventFields.endTime.optional(),
  place: eventFields.place.optional(),
  description: eventFields.description.optional(),
  repeat: eventFields.repeat.optional(),
  repeatUntil: eventFields.repeatUntil.optional(),
  reminders: eventFields.reminders.optional(),
  tz: eventFields.tz.optional(),
});
export const eventUpdatePatchSchema = z
  .strictObject(eventFields)
  .partial()
  .refine(notEmpty, NOT_EMPTY);
export type EventPatch = z.infer<typeof eventUpdatePatchSchema>;

const emptyPatch = z.strictObject({});

// ---------------------------------------------------------------------------
// Sync operations (push)
// ---------------------------------------------------------------------------

const opBase = { opId: idSchema, entityId: idSchema, hlc: hlcSchema };
const removeTypes = z.enum(['delete', 'restore']);

export const syncOpSchema = z.union([
  z.object({
    ...opBase,
    entity: z.literal('todo'),
    type: z.literal('create'),
    patch: todoCreatePatchSchema,
  }),
  z.object({
    ...opBase,
    entity: z.literal('todo'),
    type: z.literal('update'),
    patch: todoUpdatePatchSchema,
  }),
  z.object({ ...opBase, entity: z.literal('todo'), type: removeTypes, patch: emptyPatch }),
  z.object({
    ...opBase,
    entity: z.literal('list'),
    type: z.literal('create'),
    patch: listCreatePatchSchema,
  }),
  z.object({
    ...opBase,
    entity: z.literal('list'),
    type: z.literal('update'),
    patch: listUpdatePatchSchema,
  }),
  z.object({ ...opBase, entity: z.literal('list'), type: removeTypes, patch: emptyPatch }),
  z.object({
    ...opBase,
    entity: z.literal('note'),
    type: z.literal('create'),
    patch: noteCreatePatchSchema,
  }),
  z.object({
    ...opBase,
    entity: z.literal('note'),
    type: z.literal('update'),
    patch: noteUpdatePatchSchema,
  }),
  z.object({ ...opBase, entity: z.literal('note'), type: removeTypes, patch: emptyPatch }),
  z.object({
    ...opBase,
    entity: z.literal('plan'),
    type: z.literal('create'),
    patch: planCreatePatchSchema,
  }),
  z.object({
    ...opBase,
    entity: z.literal('plan'),
    type: z.literal('update'),
    patch: planUpdatePatchSchema,
  }),
  z.object({ ...opBase, entity: z.literal('plan'), type: removeTypes, patch: emptyPatch }),
  z.object({
    ...opBase,
    entity: z.literal('activity'),
    type: z.literal('create'),
    patch: activityCreatePatchSchema,
  }),
  z.object({
    ...opBase,
    entity: z.literal('activity'),
    type: z.literal('update'),
    patch: activityUpdatePatchSchema,
  }),
  z.object({ ...opBase, entity: z.literal('activity'), type: removeTypes, patch: emptyPatch }),
  z.object({
    ...opBase,
    entity: z.literal('calendar'),
    type: z.literal('create'),
    patch: calendarCreatePatchSchema,
  }),
  z.object({
    ...opBase,
    entity: z.literal('calendar'),
    type: z.literal('update'),
    patch: calendarUpdatePatchSchema,
  }),
  z.object({ ...opBase, entity: z.literal('calendar'), type: removeTypes, patch: emptyPatch }),
  z.object({
    ...opBase,
    entity: z.literal('event'),
    type: z.literal('create'),
    patch: eventCreatePatchSchema,
  }),
  z.object({
    ...opBase,
    entity: z.literal('event'),
    type: z.literal('update'),
    patch: eventUpdatePatchSchema,
  }),
  z.object({ ...opBase, entity: z.literal('event'), type: removeTypes, patch: emptyPatch }),
]);
export type SyncOp = z.infer<typeof syncOpSchema>;

/** A sync operation as stored in the Dexie `outbox` table. */
export type OutboxOp = SyncOp & { attempts: number; createdAt: number };

export const pushRequestSchema = z.object({
  clientId: clientIdSchema,
  ops: z.array(syncOpSchema).min(1).max(PUSH_BATCH_MAX),
});
export type PushRequest = z.infer<typeof pushRequestSchema>;

export const pushResponseSchema = z.object({
  accepted: z.array(idSchema),
  rejected: z.array(z.object({ opId: idSchema, reason: z.string() })),
});
export type PushResponse = z.infer<typeof pushResponseSchema>;

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

/** Pulled patches may also contain fields only the server sets. */
const pulledTodoPatch = z.strictObject({ ...todoFields, deletedAt: nullableEpochMs }).partial();
const pulledListPatch = z
  .strictObject({
    ...listFields,
    isInbox: z.boolean(),
    module: listModuleSchema,
    deletedAt: nullableEpochMs,
  })
  .partial();
const pulledNotePatch = z.strictObject({ ...noteFields, deletedAt: nullableEpochMs }).partial();
const pulledPlanPatch = z.strictObject({ ...planFields, deletedAt: nullableEpochMs }).partial();
const pulledActivityPatch = z
  .strictObject({ ...activityFields, deletedAt: nullableEpochMs })
  .partial();
const pulledCalendarPatch = z
  .strictObject({ ...calendarFields, deletedAt: nullableEpochMs })
  .partial();
const pulledEventPatch = z.strictObject({ ...eventFields, deletedAt: nullableEpochMs }).partial();
const opType = z.enum(['create', 'update', 'delete', 'restore']);
const changeBase = {
  serverSeq: z.number().int().min(1),
  entityId: idSchema,
  type: opType,
  hlc: hlcSchema,
};

export const pullChangeSchema = z.union([
  z.object({ ...changeBase, entity: z.literal('todo'), patch: pulledTodoPatch }),
  z.object({ ...changeBase, entity: z.literal('list'), patch: pulledListPatch }),
  z.object({ ...changeBase, entity: z.literal('note'), patch: pulledNotePatch }),
  z.object({ ...changeBase, entity: z.literal('plan'), patch: pulledPlanPatch }),
  z.object({ ...changeBase, entity: z.literal('activity'), patch: pulledActivityPatch }),
  z.object({ ...changeBase, entity: z.literal('calendar'), patch: pulledCalendarPatch }),
  z.object({ ...changeBase, entity: z.literal('event'), patch: pulledEventPatch }),
]);
export type PullChange = z.infer<typeof pullChangeSchema>;

export const pullResponseSchema = z.object({
  changes: z.array(pullChangeSchema),
  nextSeq: z.number().int().min(0),
  hasMore: z.boolean(),
});
export type PullResponse = z.infer<typeof pullResponseSchema>;
