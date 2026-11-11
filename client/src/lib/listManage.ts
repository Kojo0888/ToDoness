/** The "Manage lists" page: where it lives. */
export const MANAGE_LISTS_PATH = '/lists/manage';

/** "Manage note lists" (docs/note-lists FR-128). */
export const MANAGE_NOTE_LISTS_PATH = '/notes/manage';

/** The page of a note list; "My notes" lives at `/notes`. */
export const noteListPath = (id: string) => `/notes/l/${id}`;
