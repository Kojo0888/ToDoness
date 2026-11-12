/**
 * The changes made on one plan page (docs/plan/PRD.md FR-147), without any UI:
 *  - they run one after the other, so two quick changes cannot see each other half done;
 *  - each one that alters dates or links leaves an undo point: what exactly it changed;
 *  - a failure becomes an error for the page to show, never an unhandled rejection.
 */
import { getActivities } from '../data/queries';
import type { TodonessDB } from '../data/db';
import { RepoError, type Repo } from '../data/repo';
import { diffActivities, type ActivityChange, type ActivityState } from '../lib/planUndo';
import { createSerialQueue } from '../lib/serial';

/**
 * `loop`: the link would close a loop. `limit`: too many links. `depth`: groups nested too
 * deep. `failed`: anything else.
 */
export type PlanError = 'loop' | 'limit' | 'depth' | 'failed';

export interface PlanChangesState {
  /** What the last change did, for "Undo last change"; `null` when there is nothing to undo. */
  undo: ActivityChange[] | null;
  error: PlanError | null;
}

export interface PlanChanges {
  /**
   * Runs a change. Resolves to its result, or to `undefined` when it failed (then `error`
   * says why). A change that alters no dates or links (a rename) keeps the undo point.
   */
  run<T>(change: () => Promise<T>): Promise<T | undefined>;
  /** Takes the last change back: only what it changed and nobody has changed since. */
  undo(): Promise<void>;
  clearError(): void;
  getState(): PlanChangesState;
  subscribe(listener: () => void): () => void;
}

const errorOf = (err: unknown): PlanError =>
  err instanceof RepoError && (err.code === 'loop' || err.code === 'limit' || err.code === 'depth')
    ? err.code
    : 'failed';

export function createPlanChanges(deps: {
  db: TodonessDB;
  repo: Repo;
  planId: string;
  /** Asked after every successful change: sort the rows too (docs/plan-sort FR-193). */
  autoSort?: () => boolean;
}): PlanChanges {
  const { db, repo, planId, autoSort } = deps;
  const inOrder = createSerialQueue();
  const listeners = new Set<() => void>();
  let state: PlanChangesState = { undo: null, error: null };

  function set(next: Partial<PlanChangesState>) {
    state = { ...state, ...next };
    for (const l of listeners) l();
  }

  const read = async (): Promise<ActivityState[]> =>
    (await getActivities(db, planId)).map(
      ({ id, start, days, dependsOn, done, parentId, orderKey }) => ({
        id,
        start,
        days,
        dependsOn,
        done,
        parentId,
        orderKey,
      }),
    );

  return {
    run: (change) =>
      inOrder(async () => {
        try {
          const before = await read();
          const result = await change();
          if (autoSort?.()) {
            // Part of the same undo step. The change itself worked, so a failure here (the
            // plan was deleted meanwhile) is not reported as its failure.
            await repo.sortActivities(planId).catch(() => false);
          }
          const did = diffActivities(before, await read());
          set(did.length > 0 ? { undo: did, error: null } : { error: null });
          return result;
        } catch (err) {
          set({ error: errorOf(err) });
          return undefined;
        }
      }),

    undo: () =>
      inOrder(async () => {
        const point = state.undo;
        if (!point) return;
        set({ undo: null, error: null });
        try {
          await repo.revertActivities(point);
        } catch (err) {
          set({ error: errorOf(err) });
        }
      }),

    clearError() {
      if (state.error !== null) set({ error: null });
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
