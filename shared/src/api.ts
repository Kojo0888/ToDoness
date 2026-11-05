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
