# ToDoness v1 – Decisions worth remembering

> The most interesting choices made while building v1 and its follow-ups, and **why**.
> Requirements are in [PRD.md](./PRD.md), the build log is in
> [ImplementationPlan.md](./ImplementationPlan.md).

## How it was built

1. **Test first, every step.** Each step starts with tests that are run and seen to fail, then the
   code. Bugs found along the way were turned into tests first (for example the slow
   offline → online switch, see 9). Where something could not be tested the plan says so.
2. **Docs split by version.** The MVP documents moved to `docs/mvp/`, v1 has its own PRD,
   tech-stack changes and plan in `docs/v1/`. "rdp" was read as PRD.

## Sharing and collaboration

3. **Public lists are read on demand, not synced into everybody's device.** The sync model is a
   per-user change feed; copying public lists into every user's local database would make it much
   heavier (back-fill when a list becomes public, removal when it becomes private, ownership of
   foreign rows). The price: other people's lists need a connection.
4. **Editing a public list = a restricted push to the owner's data.** `POST /api/public/lists/:id/push`
   takes ordinary operations and runs them through the same `applyPush` / merge function with the
   list owner as row owner and the visitor as "actor". The change lands in the **owner's** change
   feed, so the owner's devices pick it up with the normal pull and merge it per field with their
   own (maybe offline) edits. Only task operations inside that one list are accepted: no list
   operations, no moving tasks in or out, no hijacking existing ids.
5. **"Everyone" means every logged-in user.** Sign-up is open on the intranet, so that is everybody
   who can reach the app. Only the owner can rename, delete or privatise the list. There is **no
   change history**: last write wins per field. Files in a public list can be added and removed
   by everybody, as part of "everyone can edit".

## Tasks

6. **Drag & drop with `@dnd-kit`**, not the browser's native API: it has keyboard and touch
   support and screen-reader announcements (a WCAG requirement in the MVP PRD). A drag **handle**
   keeps scrolling on touch screens working. A reorder is one new fractional `orderKey` (one
   operation, conflict-free); dropping on a sidebar list reuses "move to list". On phones the
   sidebar is hidden, so the "List" field in the task details stays the way to move tasks.
7. **One reminder per task** (1 week / 1 day / 1 hour), not several: simple to understand and to
   merge between devices. **The due time lives inside `dueAt`**, with 00:00 meaning "no time"
   (the MVP's date-only value). That avoided a data migration, but means 00:00 itself cannot be
   chosen; the time control never offers it.
8. **A reminder is identified by `taskId:dueAt:choice`.** Changing the due date or the choice makes
   a new reminder that fires again. The same string is the notification **tag**, so the app's own
   notification and the server's push replace each other instead of appearing twice.

## Reliability and operations

9. **The slow offline → online switch had a measurable cause.** A test with a "black-holed"
   connection reproduced it: a hung request kept the sync busy until its time limit, the browser's
   `online` event waited for it, and the retry came after another delay (up to 6.6 s). Now the
   `online` event abandons waiting requests and syncs at once, `offline` shows Offline immediately,
   requests give up after 3.5 s (2 s after a failure) and a dead connection is retried every
   second. Worst measured case with a silent return: 3.9 s. **Trade-off:** a request slower than
   3.5 s counts as failed. **Diagnostics** are always recorded (small ring buffer) and shown only
   to admins, because "why is it slow" needs timings, not guesses.
10. **Web push is sent by the server, with keys it creates itself.** A sweep every 30 s records a
    reminder as sent *before* sending (never twice), retries if no device could be reached, skips
    users without a subscription without using the reminder up, and deletes subscriptions the push
    service reports as gone. VAPID keys are generated once and kept in the database (env
    overrides), so there is nothing to configure. Subscriptions **follow the user, not the
    browser**: another login moves it, logout removes it.
11. **The service worker became our own file** (`injectManifest`) because push needs handlers. Its
    logic is in a plain module that is unit-tested, and its push handling was verified in real
    Chromium by delivering a push to the worker. **Not verified:** a delivery through Google's,
    Mozilla's or Apple's push service (needs the internet and a real registration) – try it once
    after deploying.
12. **Attachments are online-only, streamed to disk and limited twice** (declared length and counted
    bytes), stored under generated ids (never the uploaded name) and always served as a download
    with `nosniff` and a sandbox CSP, so an uploaded HTML/SVG cannot run in the app's origin. The
    size limit is configuration (`MAX_ATTACHMENT_MB`, default 100).
13. **"Online" means "the server heard from you in the last 30 s".** The app's 5 s sync loop is the
    heartbeat; writes are throttled to one per 5 s per user.

## Phones and screens

14. **Phone layout:** a sticky top bar replaces the floating menu button that covered controls;
    on every screen the sidebar is as tall as the viewport, so Settings and Admin never scroll
    away with a long list (the lists scroll inside it).
15. **Due time control:** an hour list and a minute list (the phones' own pickers, 5-minute steps,
    an off-grid minute is kept) plus quick choices, instead of `<input type="time">`.
16. **File pickers on phones (an interpretation to confirm on a device):** an input that accepts
    "anything" makes Android list its recorders, so the browser asks for camera and microphone
    access. On touch screens there are now two buttons: photos/videos (`image/*,video/*`) and
    documents (`application/*,text/*`), never "any file" or audio. Audio files can therefore not
    be attached from a phone. Computers keep one unrestricted picker.

## Delivery

17. **Deploy script:** `./deploy.sh user@server:/path/to/todoness` – the script adds the `release`
    folder itself (and does not double it if it was given). `--dry-run` shows the target. This
    sits in front of the safety checks that were added to `deploy.sh` on `main` meanwhile (the upload
    is an exact copy with `--delete`, so a target above the release folder would wipe the server's
    files): because the folder is always appended, the target can no longer be wrong that way.
18. **Branch workflow:** all work went to the designated branch; `main` was only changed when
    explicitly asked, through PR #6.

## Connectivity (added later)

19. **The app decides whether it is online; the browser's `navigator.onLine` is only a hint.** It
    can be wrong in both directions (VPN or virtual adapters, a LAN without internet), and the
    `online` event may never fire. It had been used in two places that mattered: the runner refused
    to send anything while the flag said offline, and every "needs a connection" part of the UI
    (including both attachment buttons) was disabled by it. Now the runner always tries, a request
    that works or a check every 3 seconds (`GET /api/health`, 2 s limit) means online, and no answer
    means offline. A server error still counts as reachable. The cost is one tiny request every
    3 seconds, which is negligible on an intranet. The admin diagnostics show "Browser says" next to
    "App found" so a wrong flag is visible.
20. **File picker buttons are labels, and the input is re-created after every pick or cancel.** The
    reported "both buttons stopped working after cancelling" was most likely the false-offline flag
    above (the buttons were disabled by it); the picker change is a precaution, and the native
    behaviour of phones could not be tested here.
