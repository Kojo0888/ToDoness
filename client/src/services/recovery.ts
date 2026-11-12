/**
 * Offers to put the data of an old account back after the server lost its database
 * (docs/v1/PRD.md section 4.11, FR-77 – FR-82).
 *
 * The session keeps the data aside (`meta.recoverySnapshot`) when someone signs up on a
 * device that holds another account's data. After the first sync of the new account the UI
 * asks; `accept` queues the data as normal changes (the usual sync sends them), `decline`
 * throws it away. Until one of them happens the snapshot stays, also across reloads.
 *
 * An account that already holds exactly the kept data (another device uploaded the same) is
 * not asked about: the kept data is dropped (docs/recovery-upload FR-168). Otherwise the UI
 * asks *Upload my data* / *Keep it empty* (empty account) or *Which data is newer?*:
 * `accept('overwrite')` = the device's, `decline()` = the server's (FR-169).
 *
 * `accept` restores first and removes the snapshot second. If the app dies in between, the
 * question comes back and restoring again merges (same ids), so nothing is duplicated.
 */
import {
  RECOVERY_KEY,
  sameData,
  takeSnapshot,
  type RecoverySnapshot,
  type RestoreMode,
} from '../data/recovery';
import type { TodonessDB } from '../data/db';
import { RepoError, type Repo } from '../data/repo';

export interface RecoveryOffer {
  /** E-mail of the account the data belonged to. */
  fromEmail: string;
  todos: number;
  lists: number;
  notes: number;
  plans: number;
  /** What the new account already holds (all 0 = empty), the Inbox not counted. */
  accountTodos: number;
  accountLists: number;
  accountNotes: number;
  accountPlans: number;
}

/** The new account holds nothing but its Inbox (docs/recovery-upload FR-163, FR-164). */
export function isAccountEmpty(offer: RecoveryOffer): boolean {
  return (
    offer.accountTodos === 0 &&
    offer.accountLists === 0 &&
    offer.accountNotes === 0 &&
    offer.accountPlans === 0
  );
}

export type AcceptResult =
  | { ok: true; lists: number; todos: number; notes: number; plans: number }
  | { ok: false; error: 'no_offer' | 'no_inbox' };

export interface Recovery {
  /** Reads the kept data; call when the app is ready (and again after a change). */
  load(): Promise<void>;
  getOffer(): RecoveryOffer | undefined;
  subscribe(listener: () => void): () => void;
  accept(mode: RestoreMode): Promise<AcceptResult>;
  decline(): Promise<void>;
}

export function createRecovery(deps: { db: TodonessDB; repo: Repo }): Recovery {
  const { db, repo } = deps;
  let offer: RecoveryOffer | undefined;
  /** Raised by every answer, so a `load` that started before it cannot bring the offer back. */
  let answers = 0;
  const listeners = new Set<() => void>();

  function set(next: RecoveryOffer | undefined) {
    offer = next;
    for (const l of listeners) l();
  }

  async function read(): Promise<RecoverySnapshot | undefined> {
    return db.getMeta<RecoverySnapshot>(RECOVERY_KEY);
  }

  return {
    async load() {
      const seen = answers;
      const snapshot = await read();
      if (!snapshot) return answers === seen ? set(undefined) : undefined;
      const accountTodos = (await db.todos.toArray()).filter((t) => t.deletedAt === null).length;
      const accountLists = (await db.lists.toArray()).filter(
        (l) => l.deletedAt === null && !l.isInbox,
      ).length;
      const accountNotes = (await db.notes.toArray()).filter((n) => n.deletedAt === null).length;
      const accountPlans = (await db.plans.toArray()).filter((p) => p.deletedAt === null).length;
      if (answers !== seen) return;
      const empty = accountTodos + accountLists + accountNotes + accountPlans === 0;
      if (!empty) {
        const account = await takeSnapshot(db, snapshot.fromEmail);
        if (answers !== seen) return;
        if (account && sameData(snapshot, account)) {
          // Nothing to decide: uploading would change nothing (FR-168).
          answers++;
          await db.meta.delete(RECOVERY_KEY);
          return set(undefined);
        }
      }
      set({
        fromEmail: snapshot.fromEmail,
        todos: snapshot.todos.length,
        lists: snapshot.lists.length,
        notes: snapshot.notes?.length ?? 0,
        plans: snapshot.plans?.length ?? 0,
        accountTodos,
        accountLists,
        accountNotes,
        accountPlans,
      });
    },

    getOffer: () => offer,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async accept(mode) {
      const snapshot = await read();
      if (!snapshot) {
        // Answered elsewhere (another tab): the offer is stale, drop it so the popup closes.
        set(undefined);
        return { ok: false, error: 'no_offer' };
      }
      let counts: { lists: number; todos: number; notes: number; plans: number };
      try {
        counts = await repo.restoreSnapshot(snapshot, mode);
      } catch (err) {
        if (err instanceof RepoError && err.code === 'not_found') {
          return { ok: false, error: 'no_inbox' };
        }
        throw err;
      }
      answers++;
      await db.meta.delete(RECOVERY_KEY);
      set(undefined);
      return { ok: true, ...counts };
    },

    async decline() {
      answers++;
      await db.meta.delete(RECOVERY_KEY);
      set(undefined);
    },
  };
}
