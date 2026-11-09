/** User administration calls (admins only; online only). */
import { adminUsersResponseSchema, type AdminUsersResponse } from '@todoness/shared';

export type AdminUser = AdminUsersResponse['users'][number];
export type FetchUsersResult = { ok: true; users: AdminUser[] } | { ok: false };

export async function fetchUsers(): Promise<FetchUsersResult> {
  try {
    const res = await fetch('/api/admin/users');
    const parsed = adminUsersResponseSchema.safeParse(await res.json());
    return res.ok && parsed.success ? { ok: true, users: parsed.data.users } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Marks the user's password for reset; `true` when the server accepted it. */
export async function resetUserPassword(userId: string): Promise<boolean> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
    method: 'POST',
  }).catch(() => undefined);
  return res?.status === 204;
}
