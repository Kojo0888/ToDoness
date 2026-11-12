# Upload my data to an empty server – implementation plan

Requirements: [`PRD.md`](./PRD.md) (FR-163 – FR-167). No data model, sync protocol, API or
migration change: client UI, texts and tests only.

## Steps

1. **Texts** – `client/src/app/strings.ts`: `recovery.upload` ("Upload my data"),
   `recovery.keepEmpty` ("Keep it empty"), `recovery.dontUpload` ("Don't upload"), the new
   question; `login.serverReset` and `login.signUpAgain`.
2. **Offer** – `client/src/services/recovery.ts`: `isAccountEmpty(offer)` (pure, unit tested).
3. **Dialog** – `client/src/components/account/RecoveryDialog.tsx`: the two answers; on an
   empty account *Upload my data* calls `accept('append')` directly (FR-164, decision U1).
4. **Login hint** – `client/src/lib/signUpAgain.ts` decides when to offer it (pure, unit
   tested); `LoginScreen.tsx` shows the hint and the **Sign up again** button, which calls
   `session.register` with the typed e-mail and password.
5. **Tests**
   - `client/test/services/recovery.test.ts`, `client/test/lib/signUpAgain.test.ts`.
   - `integration/test/sync.integration.test.ts`: task notes between devices.
   - `integration/test/notes.integration.test.ts`: note lists (create, rename, delete with
     their notes) and notes in them between devices.
   - `integration/test/plans.integration.test.ts`: rename, reorder, done, unlink, delete and
     restore of an activity between devices.
   - `integration/test/recovery.integration.test.ts`: a device holding every kind of data
     uploads it to a fresh server; a second device gets exactly the same data (FR-167).
   - `e2e/test/recovery.test.ts`, `e2e/test/notes.test.ts`: new button names, the skipped
     step on an empty account, the login hint, a plan and a task note in the upload.

## Changed on the way

- The e2e upload test switches back to the Tasks module: after the upload the app reopens
  the module the device was last in (here Plan), as it always does.
- Task notes, notes, note lists, plans and activities already synced and were already part
  of the upload; the new integration tests confirm it, and no sync code had to change.
