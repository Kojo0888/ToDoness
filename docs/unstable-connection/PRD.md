# Unstable connection and double-submit protection

## 1. Problem

On a weak connection the app answers slowly and sometimes only partly. Two things go wrong:

1. A user who sees nothing happen after pressing **Add** (new list, plan, calendar, event)
   presses it again, and the item is created several times.
2. The app keeps trying to sync as if the connection were good (after every change, every
   5 s), and every try waits for a dead or crawling connection. The badge says "All changes
   saved" or "Syncing…" although nothing is getting through, and there is no status between
   "online" and "Offline".

## 2. Goals / non-goals

Goals: one press creates one item; a new status **Connection unstable**; while unstable the
app works offline-first and pushes from time to time instead of constantly.

Non-goals: changing the sync protocol, the server, or the data model. Quick-add inputs that
clear on submit (task, note, activity) are not guarded: typing the same text twice is valid.

## 3. Requirements (numbering continues from `docs/attachments/PRD.md`)

- **FR-255** An action that creates something (new list, note list, plan, calendar in the
  sidebar and on the first-plan / first-calendar screens, saving a new event) runs **once** per
  press: while it is running, further presses are ignored (also several in the same
  millisecond), and the button is disabled and marked busy (`aria-busy`).
- **FR-256** The guard releases when the action finishes or fails, so the user can retry.
- **FR-257** A request counts as a **bad sample** when it gets no answer in time, when its
  answer is partial (the body cannot be read or is not a valid answer), or when it takes
  2 s or longer to answer. Connection checks (`/api/health`) count too. Everything else is a
  good sample.
- **FR-258** The connection is **unstable** when at least 2 of the last 6 samples are bad.
  It is **stable** again after 4 good samples in a row.
- **FR-259** The sync badge (and the admin diagnostics header) shows **Connection unstable**
  (warning tone), with the pending count. Priority: Offline > sync problem > login needed >
  Connection unstable > Data comparison > Syncing > pending > saved.
- **FR-260** While unstable the app stays usable offline: everything is written locally. Syncs
  triggered by local changes, the 5 s timer, the tab becoming visible or the browser `online`
  event are **throttled to one try per 15 s**; failed tries are retried no sooner than that
  too. An explicit `trigger()` (login again, user action) is not throttled.
- **FR-261** When the connection is stable again the normal rhythm resumes and a sync runs
  at once.

## 4. Decisions

- Thresholds (2 s slow, 2 of 6, 4 good, 15 s) are constants in `sync/linkQuality.ts` and
  `sync/runner.ts`, injectable for tests. 2 s is below the 3 s the request already feels
  too long at, and below the 3.5 s hard timeout.
- Quality lives in the connectivity store next to `online` (not in `SyncStatus`), because it is
  measured by requests and checks alike and offline must stay a separate, stronger state.
