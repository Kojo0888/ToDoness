/** User administration calls (admins only; online only). */
import {
  adminUsersResponseSchema,
  backupStatusSchema,
  type AdminUsersResponse,
  type BackupSettings,
  type BackupStatus,
} from '@todoness/shared';

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

// ---------------------------------------------------------------------------
// Backup data (docs/backup/PRD.md)
// ---------------------------------------------------------------------------

export type BackupResult = { ok: true; status: BackupStatus } | { ok: false };

async function backupCall(path: string, init?: RequestInit): Promise<BackupResult> {
  try {
    const res = await fetch(path, init);
    const parsed = backupStatusSchema.safeParse(await res.json());
    return res.ok && parsed.success ? { ok: true, status: parsed.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export const fetchBackup = (): Promise<BackupResult> => backupCall('/api/admin/backup');

export const saveBackup = (settings: BackupSettings): Promise<BackupResult> =>
  backupCall('/api/admin/backup', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings),
  });

/** Starts a backup now. `running`: the server says one is under way already. */
export async function runBackup(): Promise<
  { ok: true; status: BackupStatus } | { ok: false; running: boolean }
> {
  try {
    const res = await fetch('/api/admin/backup/run', { method: 'POST' });
    if (res.status === 409) return { ok: false, running: true };
    const parsed = backupStatusSchema.safeParse(await res.json());
    return res.ok && parsed.success
      ? { ok: true, status: parsed.data }
      : { ok: false, running: false };
  } catch {
    return { ok: false, running: false };
  }
}
