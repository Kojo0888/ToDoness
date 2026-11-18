# Attachments for notes and events – PRD

## 1. Problem

Files can be attached to tasks only (docs/v1/PRD.md section 4.5, FR-48 – FR-55). Notes and
calendar events often need a file too (a photo of a receipt, a ticket PDF).

## 2. Goals / non-goals

Goals: add, download and remove files on a **note** (details view only) and on an **event**
(details view of an existing event). Same limits, safety rules and look as for tasks.

Non-goals: attachments on note cards or in lists; public notes and public calendars showing or
accepting files (read-only places stay without files); offline upload; a new sync entity.

## 3. Requirements (continue the numbering)

- **FR-249** The note details page (`/notes/n/:id`) has an Attachments section: list with
  download links, add files, remove a file. Note cards do not show it.
- **FR-250** The page of an existing event (`/calendar/e/:id`) has the same section. A new,
  unsaved event has none (it only exists on this device; save it first).
- **FR-251** API: `GET` / `POST /api/notes/:id/attachments` and `GET` / `POST
/api/events/:id/attachments`. Downloading and removing stay `GET` / `DELETE
/api/attachments/:id` for every kind of attachment.
- **FR-252** Only the owner may list, add, download or remove files of a note or an event
  (another user gets 404, also when the note is public). A deleted note or event keeps its
  files so Undo works, but takes no new files.
- **FR-253** Size limit, file name cleaning, content type, safe download headers, streaming,
  clean-up when a user is deleted and the backup behave exactly as for tasks (FR-48 – FR-55).
- **FR-254** A note or event created on this device is synced first, then the file goes up
  (as for tasks, FR-50).

## 4. Decisions

| #   | Question                         | Decision                                                                                                                               |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | One table or one per entity?     | One `attachments` table with exactly one of `todo_id`, `note_id`, `event_id` set (CHECK). Less code, one download / delete route.      |
| A2  | Public notes?                    | Owner only. Readers of public notes do not see files (a later change if wanted).                                                       |
| A3  | Sync feed?                       | Not synced, online only, like task attachments. No compat flag needed: the feed is unchanged.                                          |
| A4  | Deleting a note / event          | Soft delete keeps the files (Undo). Hard removal of the user removes all.                                                              |
