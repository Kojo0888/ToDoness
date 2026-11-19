# Implementation plan: unstable connection

Order: tests first (they fail), then code, then checks.

1. `client/src/sync/linkQuality.ts` (new): pure tracker `createLinkQuality(opts)` with
   `record({ ok, ms }) → unstable: boolean` (FR-257, FR-258).
2. `client/src/sync/connectivity.ts`: snapshot `{ online, unstable }`, `reportUnstable(bool)`.
3. `client/src/sync/engine.ts`: option `onSample({ ok, ms })`, called for every request and
   connection check; a body that cannot be read or parsed is an extra bad (partial) sample.
4. `client/src/sync/runner.ts`: when `connectivity.getSnapshot().unstable`, `runIfAllowed` and
   the retry delay are throttled to `unstableIntervalMs` (15 s); one deferred run is kept;
   on stable, run at once (FR-260, FR-261).
5. `client/src/app/container.ts`: connect engine samples → tracker → `connectivity`.
6. `client/src/app/hooks.ts` `useUnstable`; `syncSummary.ts` (+ `SyncBadge`,
   `SyncDiagnostics`) and `strings.ts` `t.sync.unstable` (FR-259).
7. `client/src/lib/submitGuard.ts` (new): `createSubmitGuard()` and hook `useSubmitGuard()`;
   used by `NewItemForm` (Sidebar), `PlansHome`, `FirstCalendar`, `EventPage` (FR-255, FR-256).
8. `CODEBASE_MAP.md`: new files.

Compatibility: no data, API or Dexie change.
