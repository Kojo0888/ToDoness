/** Request and response shapes of the non-sync API endpoints. */
import { z } from 'zod';
import { clientIdSchema, idSchema, PUSH_BATCH_MAX } from './schemas';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
});
export type Credentials = z.infer<typeof credentialsSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX),
  newPassword: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

export const attachmentSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(255),
  size: z.number().int().min(0),
  contentType: z.string(),
  createdAt: z.number().int(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const attachmentsResponseSchema = z.object({ attachments: z.array(attachmentSchema) });
export type AttachmentsResponse = z.infer<typeof attachmentsResponseSchema>;

export const publicListSchema = z.object({
  id: idSchema,
  name: z.string(),
  ownerEmail: z.string(),
});
export type PublicList = z.infer<typeof publicListSchema>;

/** Public lists of other users (FR-34). */
export const publicListsResponseSchema = z.object({ lists: z.array(publicListSchema) });
export type PublicListsResponse = z.infer<typeof publicListsResponseSchema>;

export const publicTodoSchema = z.object({
  id: idSchema,
  title: z.string(),
  notes: z.string(),
  done: z.boolean(),
  completedAt: z.number().int().nullable(),
  dueAt: z.number().int().nullable(),
  priority: z.number().int().min(0).max(3),
  orderKey: z.string(),
  attachments: z.array(attachmentSchema),
});
export type PublicTodo = z.infer<typeof publicTodoSchema>;

/** One public list with its tasks (FR-33). */
export const publicListResponseSchema = z.object({
  list: publicListSchema,
  todos: z.array(publicTodoSchema),
});
export type PublicListResponse = z.infer<typeof publicListResponseSchema>;

export const configResponseSchema = z.object({ maxAttachmentBytes: z.number().int().min(1) });
export type ConfigResponse = z.infer<typeof configResponseSchema>;

export const roleSchema = z.enum(['admin', 'user']);
export type Role = z.infer<typeof roleSchema>;

export const meResponseSchema = z.object({
  id: idSchema,
  email: z.string(),
  role: roleSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const adminUsersResponseSchema = z.object({
  users: z.array(
    meResponseSchema.extend({
      createdAt: z.number().int(),
      /** True after an admin reset, until the user logs in again. */
      passwordReset: z.boolean(),
      /** Heard from the server recently (see ONLINE_WINDOW_SECONDS). */
      online: z.boolean(),
      /** Epoch ms of the last authenticated request, or null if never. */
      lastSeenAt: z.number().int().nullable(),
    }),
  ),
});
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;

/**
 * Push body checked loosely: each operation only needs an `opId`, so one bad
 * operation can be rejected on its own without failing the whole batch.
 */
export const pushEnvelopeSchema = z.object({
  clientId: clientIdSchema,
  ops: z
    .array(z.looseObject({ opId: idSchema }))
    .min(1)
    .max(PUSH_BATCH_MAX),
});
export type PushEnvelope = z.infer<typeof pushEnvelopeSchema>;
