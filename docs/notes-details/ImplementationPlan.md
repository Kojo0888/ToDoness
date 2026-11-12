# Note details – Implementation plan

Requirements: [PRD.md](./PRD.md). No shared, server, Dexie or sync change.

| Step | Content                                                                                                                                  | Status |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1    | Tests first: `e2e/test/notes.test.ts` (card layout, details page, delete, public switch moved)                                           | ☑      |
| 2    | `icons.tsx`: `TrashIcon`, `DetailsIcon`. `strings.ts`: texts. `styles.css`: card grid with a control column                            | ☑      |
| 3    | `NotesPage.tsx`: new `NoteCard`; `NoteEditor.tsx`: optional `large` size                                                                 | ☑      |
| 4    | `NoteDetailPage.tsx` and its route `/notes/n/:noteId` in `Shell.tsx` (before `/notes`)                                                   | ☑      |
| 5    | `CODEBASE_MAP.md`, checks (`typecheck`, `test`, `lint`, `format:check`, e2e)                                                             | ☑      |
