/**
 * Who is logged in on this device, and what the app should show
 * (docs/MVPImplementationSteps.md, Step 8).
 *
 * Rules:
 *  - Offline, a device that has logged in before opens from its local data.
 *  - A `401` is never a logout: local data and unsent changes are kept and the
 *    login screen is shown on top.
 *  - If a different person logs in on the same device, the old data is cleared
 *    (after a warning if it still has unsent changes).
 *  - The first login on a device downloads everything before the app opens.
 */
import { meResponseSchema, type MeResponse } from '@todoness/shared';
import type { TodonessDB } from '../data/db';
import { countPending } from '../data/queries';
import type { FetchFn, SyncEngine } from '../sync/engine';

export type StoredUser = MeResponse;

export type SessionState =
  | { status: 'loading' }
  | { status: 'login'; email?: string; reason?: 'expired' | 'logged_out' }
  | { status: 'offline_no_session' }
  | { status: 'initial_sync'; user: StoredUser; error?: 'offline' | 'server' }
  | { status: 'ready'; user: StoredUser };

export type AuthResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'invalid_credentials'
        | 'invalid_request'
        | 'email_taken'
        | 'too_many_attempts'
        | 'cancelled'
        | 'server'
        | 'network';
      retryAfterSec?: number;
    };

export interface SessionDeps {
  db: TodonessDB;
  engine: SyncEngine;
  fetch: FetchFn;
  /** Start (or restart after a login) the background sync. */
  resumeSync(): void;
  stopSync(): void;
  confirm(message: string): boolean;
}

export interface Session {
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  boot(): Promise<void>;
  login(email: string, password: string): Promise<AuthResult>;
  register(email: string, password: string): Promise<AuthResult>;
  logout(): Promise<boolean>;
  /** The server no longer accepts this browser's login (expired or password reset). */
  requireLogin(): Promise<void>;
  retryInitialSync(): Promise<void>;
}

const plural = (n: number) => `${n} change${n === 1 ? '' : 's'}`;

export function createSession(deps: SessionDeps): Session {
  const { db, engine, fetch, resumeSync, stopSync, confirm } = deps;

  let state: SessionState = { status: 'loading' };
  const listeners = new Set<() => void>();

  function setState(next: SessionState) {
    state = next;
    for (const l of listeners) l();
  }

  const post = (path: string, body?: unknown) =>
    fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  async function storedUser(): Promise<StoredUser | undefined> {
    return db.getMeta<StoredUser>('user');
  }

  async function runInitialSync(user: StoredUser) {
    setState({ status: 'initial_sync', user });
    const result = await engine.sync();
    if (result.ok) {
      await db.setMeta('initialSyncDone', true);
      setState({ status: 'ready', user });
      resumeSync();
    } else if (result.kind === 'auth') {
      setState({ status: 'login', email: user.email, reason: 'expired' });
    } else {
      setState({
        status: 'initial_sync',
        user,
        error: result.kind === 'offline' ? 'offline' : 'server',
      });
    }
  }

  /** The server accepted this login: switch the device to this user. */
  async function enter(me: StoredUser) {
    const stored = await storedUser();
    if (stored && stored.id !== me.id) await db.clearAll();
    await db.meta.delete('pendingLogout');
    await db.setMeta('user', me);
    if (await db.getMeta<boolean>('initialSyncDone')) {
      setState({ status: 'ready', user: me });
      resumeSync();
    } else {
      await runInitialSync(me);
    }
  }

  async function authenticate(path: string, email: string, password: string): Promise<AuthResult> {
    let res: Response;
    try {
      res = await post(path, { email, password });
    } catch {
      return { ok: false, error: 'network' };
    }

    if (!res.ok) {
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after'));
        return {
          ok: false,
          error: 'too_many_attempts',
          ...(wait > 0 ? { retryAfterSec: wait } : {}),
        };
      }
      const code = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      if (res.status === 401) return { ok: false, error: 'invalid_credentials' };
      if (res.status === 400 || code === 'invalid_request')
        return { ok: false, error: 'invalid_request' };
      if (res.status === 409) return { ok: false, error: 'email_taken' };
      return { ok: false, error: 'server' };
    }

    const parsed = meResponseSchema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) return { ok: false, error: 'server' };
    const me = parsed.data;

    const stored = await storedUser();
    if (stored && stored.id !== me.id) {
      const pending = await countPending(db);
      if (
        pending > 0 &&
        !confirm(
          `This device still has ${plural(pending)} of ${stored.email} that were not sent to the server. ` +
            `Logging in as ${me.email} will delete them. Continue?`,
        )
      ) {
        await post('/api/auth/logout').catch(() => undefined);
        return { ok: false, error: 'cancelled' };
      }
    }

    await enter(me);
    return { ok: true };
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async boot() {
      setState({ status: 'loading' });

      // The user logged out while offline: the server session is still valid, so
      // finish the logout now instead of silently logging them back in.
      if (await db.getMeta<boolean>('pendingLogout')) {
        const sent = await post('/api/auth/logout').then(
          () => true,
          () => false,
        );
        if (sent) await db.meta.delete('pendingLogout');
        return setState({ status: 'login', reason: 'logged_out' });
      }

      const stored = await storedUser();

      let res: Response | undefined;
      try {
        res = await fetch('/api/me');
      } catch {
        res = undefined; // offline
      }

      if (res?.ok) {
        const parsed = meResponseSchema.safeParse(await res.json().catch(() => undefined));
        if (parsed.success) return enter(parsed.data);
      } else if (res?.status === 401) {
        return setState(
          stored
            ? { status: 'login', email: stored.email, reason: 'expired' }
            : { status: 'login' },
        );
      }

      // No answer, or a server problem: work from local data if this device has been used.
      if (stored) {
        setState({ status: 'ready', user: stored });
        resumeSync();
      } else {
        setState({ status: 'offline_no_session' });
      }
    },

    login: (email, password) => authenticate('/api/auth/login', email, password),
    register: (email, password) => authenticate('/api/auth/register', email, password),

    async logout() {
      const pending = await countPending(db);
      if (
        pending > 0 &&
        !confirm(
          `${plural(pending)} have not been sent to the server yet. ` +
            'If you log out now, they will be lost. Log out anyway?',
        )
      ) {
        return false;
      }
      stopSync();
      const sent = await post('/api/auth/logout').then(
        () => true,
        () => false,
      );
      await db.clearAll();
      if (!sent) await db.setMeta('pendingLogout', true); // tell the server at the next start
      setState({ status: 'login', reason: 'logged_out' });
      return true;
    },

    async requireLogin() {
      const stored = await storedUser();
      setState({ status: 'login', ...(stored ? { email: stored.email } : {}), reason: 'expired' });
    },

    async retryInitialSync() {
      const user = state.status === 'initial_sync' ? state.user : await storedUser();
      if (user) await runInitialSync(user);
    },
  };
}
