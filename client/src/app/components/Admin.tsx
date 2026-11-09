import { adminUsersResponseSchema, type AdminUsersResponse } from '@todoness/shared';
import { useCallback, useEffect, useState } from 'react';
import type { StoredUser } from '../session';
import { connectivity } from '../services';
import { t } from '../strings';
import { ConfirmDialog } from './ConfirmDialog';

type Users = AdminUsersResponse['users'];

const REFRESH_MS = 5000;

async function fetchUsers(): Promise<{ ok: true; users: Users } | { ok: false }> {
  try {
    const res = await fetch('/api/admin/users');
    const parsed = adminUsersResponseSchema.safeParse(await res.json());
    return res.ok && parsed.success ? { ok: true, users: parsed.data.users } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export function Admin({ user }: { user: StoredUser }) {
  const [users, setUsers] = useState<Users | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [target, setTarget] = useState<Users[number] | null>(null);

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchUsers>>) => {
    if (result.ok) {
      setUsers(result.users);
      setError(null);
    } else {
      setError(connectivity.getSnapshot().online ? t.admin.loadFailed : t.admin.needsConnection);
    }
  }, []);

  // Load now, then every few seconds so the "Online" column stays current.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void fetchUsers().then((result) => {
        if (!cancelled) apply(result);
      });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [apply]);

  async function reset(u: Users[number]) {
    setTarget(null);
    const res = await fetch(`/api/admin/users/${u.id}/reset-password`, { method: 'POST' }).catch(
      () => undefined,
    );
    if (res?.status === 204) setMessage(t.admin.resetDone(u.email));
    else setError(t.admin.loadFailed);
    apply(await fetchUsers());
  }

  return (
    <section className="page">
      <h2>{t.admin.title}</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {users && (
        <table className="users">
          <thead>
            <tr>
              <th>{t.admin.email}</th>
              <th>{t.admin.online}</th>
              <th>{t.admin.role}</th>
              <th>{t.admin.status}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>
                  <OnlineIndicator online={u.online} lastSeenAt={u.lastSeenAt} />
                </td>
                <td>{u.role}</td>
                <td>{u.passwordReset ? t.admin.resetPending : t.admin.active}</td>
                <td>
                  {u.id !== user.id && (
                    <button
                      type="button"
                      onClick={() => setTarget(u)}
                      aria-label={`${t.admin.reset}: ${u.email}`}
                    >
                      {t.admin.reset}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ConfirmDialog
        open={target !== null}
        title={t.admin.resetTitle}
        confirmLabel={t.admin.reset}
        onCancel={() => setTarget(null)}
        onConfirm={() => target && void reset(target)}
      >
        <p>{target ? t.admin.resetText(target.email) : ''}</p>
      </ConfirmDialog>
    </section>
  );
}

/** A coloured dot plus words, so the state does not depend on colour alone. */
function OnlineIndicator({ online, lastSeenAt }: { online: boolean; lastSeenAt: number | null }) {
  const title =
    lastSeenAt === null
      ? t.admin.neverSeen
      : t.admin.lastSeen(new Date(lastSeenAt).toLocaleString());
  return (
    <span className={`online-indicator ${online ? 'is-online' : 'is-offline'}`} title={title}>
      <span className="online-dot" aria-hidden="true" />
      {online ? t.admin.isOnline : t.admin.isOffline}
    </span>
  );
}
