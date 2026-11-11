/**
 * Talks to the server: pushes the outbox, pulls changes
 * (docs/mvp/TechStack.md section 6, docs/mvp/MVPImplementationSteps.md Step 6).
 */
import {
  newClientId,
  pullResponseSchema,
  pushResponseSchema,
  type OutboxOp,
} from '@todoness/shared';
import type { PublicOp, TodonessDB } from '../data/db';
import { overlayListPage, overlayNotes } from '../data/publicOverlay';
import { applyChanges } from './apply-changes';
import type { SyncDiagnostics } from './diagnostics';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type SyncErrorKind = 'offline' | 'auth' | 'server';

export class SyncError extends Error {
  override name = 'SyncError';
  constructor(
    readonly kind: SyncErrorKind,
    message: string = kind,
  ) {
    super(message);
  }
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'error' | 'auth_required';
  lastSyncAt: number | null;
  error?: string;
}

export type SyncResult = { ok: true } | { ok: false; kind: SyncErrorKind; message: string };

export interface SyncEngine {
  readonly status: SyncStatus;
  push(): Promise<{ sent: number; rejected: number }>;
  pull(): Promise<{ applied: number }>;
  /** Push, then pull. Never throws: problems are returned and set on `status`. */
  sync(): Promise<SyncResult>;
  markOffline(): void;
  /** Gives up on every request that is waiting (the connection changed): they fail at once. */
  abort(): void;
  /** Is the server reachable? Any answer counts, even an error. Never changes the status. */
  ping(): Promise<boolean>;
  subscribe(listener: (status: SyncStatus) => void): () => void;
}

export interface EngineOptions {
  db: TodonessDB;
  fetch: FetchFn;
  now?: () => number;
  batchSize?: number;
  pullLimit?: number;
  /** A request that gets no answer within this time counts as offline. */
  requestTimeoutMs?: number;
  /** The same, while the last sync failed: the next try must not wait long again. */
  degradedTimeoutMs?: number;
  /** How long a connection check waits for an answer. */
  pingTimeoutMs?: number;
  /** Records timings for the admin diagnostics. */
  diag?: SyncDiagnostics;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export function createSyncEngine(opts: EngineOptions): SyncEngine {
  const {
    db,
    fetch,
    now = Date.now,
    batchSize = 50,
    pullLimit = 500,
    requestTimeoutMs = 3500,
    degradedTimeoutMs = 2000,
    pingTimeoutMs = 2000,
    diag,
  } = opts;

  let status: SyncStatus = { state: 'idle', lastSyncAt: null };
  const listeners = new Set<(s: SyncStatus) => void>();
  let inFlight: Promise<SyncResult> | undefined;

  function setStatus(next: SyncStatus) {
    status = next;
    for (const l of listeners) l(status);
  }

  /** Requests that are waiting for an answer, so `abort()` can end them. */
  const waiting = new Set<() => void>();
  /** True after a failed sync until one works: requests then give up sooner. */
  let degraded = false;

  async function request(url: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    // A connection that dies silently never answers. Without a time limit the sync
    // would wait forever and the runner would never start another one.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let giveUp!: () => void;
    let how = 'timeout' as 'timeout' | 'aborted';
    const gaveUp = new Promise<never>((_, reject) => {
      giveUp = () => {
        controller.abort();
        reject(new Error(how));
      };
      timer = setTimeout(
        giveUp,
        degraded ? Math.min(degradedTimeoutMs, requestTimeoutMs) : requestTimeoutMs,
      );
    });
    const abort = () => {
      how = 'aborted';
      giveUp();
    };
    waiting.add(abort);
    const what = new URL(url, 'http://x').pathname
      .replace('/api/sync/', '')
      .replace(/^\/api\/public\/(lists|notes)\/[^/]+\/push$/, 'public $1 push');
    const id = diag?.requestStart(what) ?? 0;
    try {
      res = await Promise.race([fetch(url, { ...init, signal: controller.signal }), gaveUp]);
    } catch {
      diag?.requestEnd(id, how === 'aborted' ? 'aborted' : 'no answer (timeout)');
      throw new SyncError('offline', 'Cannot reach the server');
    } finally {
      clearTimeout(timer);
      waiting.delete(abort);
    }
    diag?.requestEnd(id, `answered ${res.status}`);
    if (res.status === 401) throw new SyncError('auth', 'Login required');
    if (res.status >= 500 || res.status === 408 || res.status === 429) {
      throw new SyncError('server', `Server answered ${res.status}`);
    }
    return res;
  }

  async function ensureClientId(): Promise<string> {
    let id = await db.getMeta<string>('clientId');
    if (!id) {
      id = newClientId();
      await db.setMeta('clientId', id);
    }
    return id;
  }

  const wire = (o: OutboxOp | PublicOp) => {
    const { attempts, createdAt, ...op } = o;
    void attempts;
    void createdAt;
    if ('target' in op) {
      const { target, targetId, ...rest } = op;
      void target;
      void targetId;
      return rest;
    }
    return op;
  };

  async function markAttempt(ops: OutboxOp[]) {
    await db.outbox
      .where('opId')
      .anyOf(ops.map((o) => o.opId))
      .modify((o) => {
        o.attempts += 1;
      });
  }

  async function moveToDeadLetter(ops: { op: OutboxOp; reason: string }[]) {
    if (ops.length === 0) return;
    await db.transaction('rw', db.outbox, db.deadLetter, async () => {
      for (const { op, reason } of ops) {
        await db.deadLetter.put({ ...op, failedAt: now(), reason });
        await db.outbox.delete(op.opId);
      }
    });
  }

  async function push() {
    let sent = 0;
    let rejected = 0;

    for (;;) {
      const ops = await db.outbox.orderBy('hlc').limit(batchSize).toArray();
      if (ops.length === 0) return { sent, rejected };

      const clientId = await ensureClientId();
      let res: Response;
      try {
        res = await request('/api/sync/push', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ clientId, ops: ops.map(wire) }),
        });
      } catch (err) {
        if (err instanceof SyncError && err.kind !== 'auth') await markAttempt(ops);
        throw err;
      }

      if (!res.ok) {
        // The server refused the whole batch as invalid: retrying cannot help.
        await moveToDeadLetter(ops.map((op) => ({ op, reason: `http_${res.status}` })));
        rejected += ops.length;
        continue;
      }

      const parsed = pushResponseSchema.safeParse(await res.json().catch(() => undefined));
      if (!parsed.success) {
        await markAttempt(ops);
        throw new SyncError('server', 'Unexpected answer to push');
      }
      const { accepted, rejected: refused } = parsed.data;
      if (accepted.length + refused.length === 0) {
        await markAttempt(ops);
        throw new SyncError('server', 'The server did not answer about any operation');
      }

      const byId = new Map(ops.map((o) => [o.opId, o]));
      await db.transaction('rw', db.outbox, db.deadLetter, async () => {
        await db.outbox.bulkDelete(accepted.filter((id) => byId.has(id)));
      });
      await moveToDeadLetter(
        refused.flatMap((r) =>
          byId.has(r.opId) ? [{ op: byId.get(r.opId)!, reason: r.reason }] : [],
        ),
      );
      sent += accepted.length;
      rejected += refused.length;
    }
  }

  async function markPublicAttempt(ops: PublicOp[]) {
    await db.publicOutbox
      .where('opId')
      .anyOf(ops.map((o) => o.opId))
      .modify((o) => {
        o.attempts += 1;
      });
  }

  async function publicToDeadLetter(ops: { op: PublicOp; reason: string }[]) {
    if (ops.length === 0) return;
    await db.transaction('rw', db.publicOutbox, db.deadLetter, async () => {
      for (const { op, reason } of ops) {
        await db.deadLetter.put({ ...op, failedAt: now(), reason });
        await db.publicOutbox.delete(op.opId);
      }
    });
  }

  /** Applies accepted public changes to the kept copy of their list or of the public notes. */
  async function writeIntoCopy(target: PublicOp, accepted: PublicOp[]) {
    if (accepted.length === 0) return;
    const key = target.target === 'list' ? `list:${target.targetId}` : 'notes';
    const row = await db.publicCache.get(key);
    if (!row || row.value === 'gone') return;
    const value =
      target.target === 'list'
        ? overlayListPage(row.value as Parameters<typeof overlayListPage>[0], accepted)
        : overlayNotes(row.value as Parameters<typeof overlayNotes>[0], accepted);
    await db.publicCache.put({ key, value, at: row.at, rev: (row.rev ?? 0) + 1 }); // no ETag: it changed
  }

  /**
   * Sends the queued changes to other users' public data (docs/notes/PRD.md FR-108): the
   * oldest change first, together with the other queued changes of the same list or note,
   * through that list's or note's restricted push. Refusals are not retried (FR-109).
   */
  async function pushPublic() {
    let sent = 0;
    let rejected = 0;
    for (;;) {
      const first = await db.publicOutbox.orderBy('hlc').first();
      if (!first) return { sent, rejected };
      const ops = (await db.publicOutbox.where('targetId').equals(first.targetId).toArray())
        .filter((o) => o.target === first.target)
        .sort((a, b) => (a.hlc < b.hlc ? -1 : 1))
        .slice(0, batchSize);

      const clientId = await ensureClientId();
      const url = `/api/public/${first.target === 'list' ? 'lists' : 'notes'}/${encodeURIComponent(first.targetId)}/push`;
      let res: Response;
      try {
        res = await request(url, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ clientId, ops: ops.map(wire) }),
        });
      } catch (err) {
        if (err instanceof SyncError && err.kind !== 'auth') await markPublicAttempt(ops);
        throw err;
      }

      if (res.status === 404) {
        // Private or deleted meanwhile: nothing of this target can be saved any more.
        const all = (
          await db.publicOutbox.where('targetId').equals(first.targetId).toArray()
        ).filter((o) => o.target === first.target);
        await publicToDeadLetter(all.map((op) => ({ op, reason: 'gone' })));
        rejected += all.length;
        continue;
      }
      if (!res.ok) {
        await publicToDeadLetter(ops.map((op) => ({ op, reason: `http_${res.status}` })));
        rejected += ops.length;
        continue;
      }

      const parsed = pushResponseSchema.safeParse(await res.json().catch(() => undefined));
      if (!parsed.success || parsed.data.accepted.length + parsed.data.rejected.length === 0) {
        await markPublicAttempt(ops);
        throw new SyncError('server', 'Unexpected answer to a public push');
      }
      const byId = new Map(ops.map((o) => [o.opId, o]));
      const accepted = parsed.data.accepted.flatMap((id) => byId.get(id) ?? []);
      // The accepted values go into the kept copy in the same step that takes them out of
      // the queue, so the page never shows the old copy in between (review fix). The next
      // refresh brings the server's merged result.
      await db.transaction('rw', db.publicOutbox, db.publicCache, async () => {
        await writeIntoCopy(first, accepted);
        await db.publicOutbox.bulkDelete(accepted.map((o) => o.opId));
      });
      await publicToDeadLetter(
        parsed.data.rejected.flatMap((r) =>
          byId.has(r.opId) ? [{ op: byId.get(r.opId)!, reason: r.reason }] : [],
        ),
      );
      sent += parsed.data.accepted.length;
      rejected += parsed.data.rejected.length;
    }
  }

  async function pull() {
    let applied = 0;
    for (;;) {
      const since = (await db.getMeta<number>('lastServerSeq')) ?? 0;
      const res = await request(
        `/api/sync/pull?since=${since}&limit=${pullLimit}&reminders=list&plans=1`,
      );
      if (!res.ok) throw new SyncError('server', `Server answered ${res.status}`);

      const parsed = pullResponseSchema.safeParse(await res.json().catch(() => undefined));
      if (!parsed.success) throw new SyncError('server', 'Unexpected answer to pull');

      applied += await applyChanges(db, parsed.data.changes, parsed.data.nextSeq, now);
      if (!parsed.data.hasMore) return { applied };
    }
  }

  async function runSync(): Promise<SyncResult> {
    setStatus({ state: 'syncing', lastSyncAt: status.lastSyncAt });
    try {
      await push();
      await pushPublic();
      await pull();
      degraded = false;
      setStatus({ state: 'idle', lastSyncAt: now() });
      return { ok: true };
    } catch (err) {
      const kind: SyncErrorKind = err instanceof SyncError ? err.kind : 'server';
      const message = err instanceof Error ? err.message : String(err);
      degraded = true;
      const state = kind === 'offline' ? 'offline' : kind === 'auth' ? 'auth_required' : 'error';
      setStatus({ state, lastSyncAt: status.lastSyncAt, error: message });
      return { ok: false, kind, message };
    }
  }

  return {
    get status() {
      return status;
    },
    push,
    pull,
    sync() {
      inFlight ??= runSync().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
    async ping() {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('timeout'));
        }, pingTimeoutMs);
      });
      try {
        await Promise.race([
          fetch('/api/health', { signal: controller.signal, cache: 'no-store' }),
          timedOut,
        ]);
        return true;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
    abort() {
      for (const stop of [...waiting]) stop();
    },
    markOffline() {
      setStatus({ state: 'offline', lastSyncAt: status.lastSyncAt });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
