# Upload my data to an empty server – PRD

Follows [`../v1/PRD.md`](../v1/PRD.md) section 4.11 (recovery after the server lost its data,
FR-77 – FR-82), [`../notes/PRD.md`](../notes/PRD.md) FR-98 and [`../plan/PRD.md`](../plan/PRD.md)
FR-144.

## 1. Problem

A device still holds the user's data (tasks with their notes, lists, notes, note lists, plans)
and the server it talks to is new or was set up again, so the user's account there is empty.

- The upload question exists, but its answers ("Yes, push it" / "No, discard it") do not say
  what happens, and on an empty account "Yes" still asks *Overwrite or append?*, a question
  that makes no sense when there is nothing to overwrite.
- The user's first move is to **log in**. On a fresh server the account does not exist, the
  login fails with "The e-mail or password is wrong." and nothing leads to the upload
  question (only **signing up** again does).

## 2. Goals / non-goals

Goals: the first login on a fresh server ends in a clear question with two plain answers, and
everything the device holds reaches the server and the user's other devices.

Non-goals: attachments (they only ever live on the server, decision D3 of v1); detecting a
fresh server automatically (it would tell anyone whether an e-mail has an account); push
subscriptions, ntfy topics and reminder settings (set up again per device).

## 3. Requirements

| ID     | Requirement                                                                                                                                                                                                                                                                                                                                                         | Priority |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-163 | The upload question (FR-78) says that the account on the server is empty and what the device holds (tasks, lists, notes, plans, and the old account's e-mail). Its two answers are **Upload my data** and **Keep it empty**.                                                                                                                                       | Must     |
| FR-164 | On an **empty** account, *Upload my data* uploads at once (nothing to overwrite, so FR-79's *Overwrite or append?* step is skipped). When the account already holds data (another device signed up first), *Upload my data* still asks *Overwrite or append?* and the other answer reads **Don't upload** (the account is not empty, so "Keep it empty" would be wrong). | Must     |
| FR-165 | The question stays until one of the answers is pressed: Escape does not close it, and it comes back after a reload, after closing the app and after the login expires and the user logs in again (FR-82).                                                                                                                                                         | Must     |
| FR-166 | When a **login** fails as "wrong e-mail or password" with the e-mail the device's data belongs to, the login screen says the server may have been set up again and offers **Sign up again**: it creates the account with the typed e-mail and password, and the upload question follows (FR-163).                                                                  | Must     |
| FR-167 | Everything that syncs also uploads: tasks (with their notes, due date, reminders, priority, done state), lists, notes (their note list and public flag), note lists, plans and activities (dates, links, done). Covered by integration tests through a fresh server and a second device.                                                                          | Must     |

## 4. Decisions

| #   | Topic                                     | Decision                                                                                                                                                                                       |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Upload on an empty account: append or overwrite? | Append. Both give the same result on an empty account; append never deletes, so it is the safe one if another device adds something at the same moment.                                            |
| U2  | How does the login screen know the server is new? | It does not. The hint only appears after a failed login with the e-mail of the data on this device, and is worded as a possibility ("may have been set up again"), so a mistyped password is not misread. |

## 5. Update 1: compare the device's data with the server's at login (FR-168 – FR-171)

The request: at login, check whether the server already holds data of the user. If it does and
it differs from the data on the device, ask which is newer: *server* keeps the server's data,
*device* replaces the server's data with the device's. If the server holds nothing, ask
*Upload my data* / *Keep it empty* (FR-163).

| ID     | Requirement                                                                                                                                                                                                                                                                                                                                                                                                        | Priority |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-168 | When the device keeps data aside at login (FR-77) and the account on the server **already holds data**, the app compares the two once the first sync is done. They are **the same** when uploading would change nothing: the same tasks, lists, notes, note lists, plans and activities (same ids, same values; tasks of the old Inbox count as Inbox tasks). The same data asks nothing: the copy on the device is dropped. | Must     |
| FR-169 | When they differ, the popup says what the server holds and what the device holds and asks **Which data is newer?** with two answers: **Server data is newer** (the device's copy is deleted, the server's data stays) and **Data on this device is newer** (every task, list, note and plan on the server is deleted and replaced with the device's data, on every device of the account). This replaces the *Overwrite or append?* step and *Don't upload* of FR-164. | Must     |
| FR-170 | An empty account still gets *Upload my data* / *Keep it empty* (FR-163, FR-164). If the account fills while the question is open (another device uploads), the question changes to FR-169, or goes away when the data is now the same (FR-168).                                                                                                                                                                    | Must     |
| FR-171 | Logging in again to the **same** account (same user id, e.g. after the login expired) asks nothing: the device's unsent changes are sent and the sync merges every field by the time of its last change, so afterwards device and server hold the same data (FR-168 would always find "the same").                                                                                                                | Must     |

| #   | Topic                                     | Decision                                                                                                                                                                                                                                               |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U3  | What counts as "the same"?                | Exactly what an upload would write (the fields `Repo.restoreSnapshot` sends), compared row by row by id. Field clocks and timestamps are not compared: uploading the same data again gives new ones without changing anything the user sees.          |
| U4  | No *Append* any more?                     | The request names two answers. Appending two different versions of the same data mostly duplicates it; when both sides have something worth keeping, the newer side wins as asked.                                                                       |
| U5  | Show the time of the last change on each side? | No. Data uploaded by another device after the server loss carries the time of that upload, so the server would look newer even when it holds the older version. The popup shows what each side holds instead.                                       |
| U6  | Same account: ask too?                    | No (FR-171). The per-field merge already keeps the newer value of every field; a question there would ask about differences that the next sync removes anyway.                                                                                         |

## 6. Update 2: "Data comparison" in the sync status (FR-172)

| ID     | Requirement                                                                                                                                                                                                                                                                                                                                     | Priority |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-172 | While the device's data is being compared with the server's (data kept aside at login, from the comparison until *Upload my data*, *Keep it empty*, *Server data is newer* or *Data on this device is newer* is pressed, or until the comparison finds the same data), the sync status shows **Data comparison** with its own colour (purple), in the badge and in the admin diagnostics. Offline, a sync problem and a needed login still show first: they need the user. | Must     |

| #   | Topic                         | Decision                                                                                                                                                                                         |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U7  | Only while the comparison runs? | The comparison itself takes milliseconds; the status would only flicker. It lasts until the question is answered, because until then the data is not settled and the device's copy is not on the server. |
| U8  | Purple                        | New colour variable `--compare` (light `#7b2fbf`, dark `#c9a0ff`), text and dot, contrast above 4.5:1 on the background in both themes.                                                          |
