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
