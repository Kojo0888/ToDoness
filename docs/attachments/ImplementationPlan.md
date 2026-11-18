# Attachments for notes and events – implementation plan

## Server

1. `server/src/db/migrations/014_attachments_notes_events.sql` – rebuild `attachments`:
   `todo_id` nullable, new nullable `note_id` / `event_id` (both `ON DELETE CASCADE`),
   `CHECK` exactly one is set, an index per column. Existing rows are copied.
2. `server/src/routes/attachments.ts` – a parent is `{ kind, id }`. `todoAccess` stays;
   `ownedAccess` handles notes and events (owner only, `deleted` flag). One list / upload
   handler is registered for `/todos/:id`, `/notes/:id`, `/events/:id`. `find` resolves access
   from whichever parent column is set.

## Client

3. `client/src/services/attachments.ts` – `AttachmentParent` (`{ kind, id }`; a plain string
   still means a task). URLs follow the kind.
4. `client/src/components/lists/Attachments.tsx` – `AttachmentsSection` takes `parent`.
5. `NoteDetailPage` and `EventPage` (existing events only) render the section.
6. `strings.ts` – the "not on the server yet" error no longer says "task".

## Tests (written first)

`server/test/attachments.test.ts` (notes and events: upload, list, download, owner only,
Undo, clean-up), `server/test/migrate.test.ts` (rows kept, CHECK, cascade),
`client/test/services/attachments.test.ts` (URLs), `e2e/test/attachments.test.ts`.

## Compatibility

Older apps never call the new routes; the sync feed is unchanged. Migration keeps all rows.
