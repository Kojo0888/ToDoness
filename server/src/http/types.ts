import type { Role } from '@todoness/shared';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

/** Values the middleware puts on the Hono context. */
export type AppEnv = {
  Variables: {
    user: AuthUser;
  };
};
