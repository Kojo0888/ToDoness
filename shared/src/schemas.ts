/**
 * Data shapes shared by client and server (see DBModel.md sections 4 and 5).
 *
 * Patch schemas are strict: they are the whitelist of fields a client may
 * change. Any other field (userId, fieldHlc, deletedAt, isInbox, …) makes the
 * operation invalid.
 */
import { z } from 'zod';
import { isHlc, isValidClientId } from './hlc';

export const TITLE_MAX = 500;
export const NOTES_MAX = 10_000;
export const LIST_NAME_MAX = 200;
export const ORDER_KEY_MAX = 200;
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
export const prioritySchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

const todoFields = {
  listId: idSchema,
  title: z.string().trim().min(1).max(TITLE_MAX),
  notes: z.string().max(NOTES_MAX),
  done: z.boolean(),
  completedAt: nullableEpochMs,
  dueAt: nullableEpochMs,
  priority: prioritySchema,
  orderKey: orderKeySchema,
};

const listFields = {
  name: z.string().trim().min(1).max(LIST_NAME_MAX),
  orderKey: orderKeySchema,
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

export const listSchema = z.object({ ...listFields, isInbox: z.boolean(), ...rowMeta });
export type List = z.infer<typeof listSchema>;

export type Entity = 'todo' | 'list';
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
});
export const todoUpdatePatchSchema = z
  .strictObject(todoFields)
  .partial()
  .refine(notEmpty, NOT_EMPTY);
export type TodoPatch = z.infer<typeof todoUpdatePatchSchema>;

export const listCreatePatchSchema = z.strictObject(listFields);
export const listUpdatePatchSchema = z
  .strictObject(listFields)
  .partial()
  .refine(notEmpty, NOT_EMPTY);
export type ListPatch = z.infer<typeof listUpdatePatchSchema>;

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
  .strictObject({ ...listFields, isInbox: z.boolean(), deletedAt: nullableEpochMs })
  .partial();
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
]);
export type PullChange = z.infer<typeof pullChangeSchema>;

export const pullResponseSchema = z.object({
  changes: z.array(pullChangeSchema),
  nextSeq: z.number().int().min(0),
  hasMore: z.boolean(),
});
export type PullResponse = z.infer<typeof pullResponseSchema>;
