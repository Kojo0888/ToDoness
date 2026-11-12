# Sort activities and Auto sort – implementation plan

Requirements: [`PRD.md`](./PRD.md) (FR-189 – FR-194). No data model, sync protocol, API or
migration change: only `orderKey` values of existing activities are written.

## Steps

1. **Rule** – `shared/src/plan.ts`: `sortedActivityIds(activities, links?)` – pure; returns the
   ids of the live activities in the wanted row order (top level sorted, then every group's
   children, pre-order). Per sibling set: stable topological order, priority (span start,
   present row index); sibling edges from the leaf link graph (reachability); a stuck set
   (loop between groups) is broken at the best priority.
2. **Repo** – `client/src/data/repo.ts`: `sortActivities(planId): Promise<boolean>`. Compares the
   wanted order with the present one; from the first difference on, gives the rows new keys
   after the plan's last row (deleted rows included, so no key is reused) with
   `generateNKeysBetween`. Returns whether it changed anything.
3. **Undo** – `client/src/lib/planUndo.ts`: `ActivityState` gets `orderKey`; `diffActivities`
   records it; `revertActivities` writes it back only where the key is still the one the change
   wrote. `planChanges.ts` reads `orderKey` too.
4. **Auto sort in the change queue** – `createPlanChanges({ autoSort?: () => boolean })`: after
   a change (not after undo) that succeeded, `repo.sortActivities` runs inside the same step,
   before the undo point is taken.
5. **Device setting** – `client/src/lib/planAutoSort.ts` (like `planHideDone.ts`).
6. **UI** – `PlanOptions.tsx`: a **Sort activities** button and an **Auto sort** switch row;
   `PlanPage.tsx` wires them (`changes.run(() => repo.sortActivities(planId))`; turning auto
   sort on sorts once). Texts in `app/strings.ts` (`plan.sort`, `plan.autoSort`), styles for the
   row in `styles.css`.
7. **Docs** – `CODEBASE_MAP.md` (new lib file, `plan.ts` entry).

## Tests (written first)

- `shared/test/plan.test.ts`: `sortedActivityIds`.
- `client/test/lib/planAutoSort.test.ts`.
- `client/test/data/plan-sort.test.ts`: `sortActivities`, undo of it.
- `client/test/services/plan-changes.test.ts`: auto sort joins the undo step.
- `e2e/test/plan-sort.test.ts`: button, switch, reload.
