/**
 * Other users' public notes (docs/notes/PRD.md FR-95 – FR-97). Online only, like public
 * lists: read on demand, and every text change is one operation sent at once to the
 * server, which applies it to the owner's note.
 */
import {
  newId,
  publicNotesResponseSchema,
  pushResponseSchema,
  syncOpSchema,
  type PublicNote,
} from '@todoness/shared';
import { nextHlc } from '../data/clock';
import type { TodonessDB } from '../data/db';
import type { FetchFn } from '../sync/engine';
import type { EditResult } from './publicEdit';

export interface PublicNotes {
  /** The public notes of other users, or `undefined` if the server cannot be reached. */
  list(): Promise<PublicNote[] | undefined>;
  saveText(noteId: string, text: string): Promise<EditResult>;
  /** Called after every accepted change (the page reloads the notes). */
  subscribe(listener: () => void): () => void;
}

export function createPublicNotes(deps: {
  db: TodonessDB;
  fetch: FetchFn;
  now?: () => number;
}): PublicNotes {
  const { db, fetch, now = Date.now } = deps;
  const listeners = new Set<() => void>();

  return {
    async list() {
      try {
        const res = await fetch('/api/public/notes');
        if (!res.ok) return undefined;
        const parsed = publicNotesResponseSchema.safeParse(await res.json());
        return parsed.success ? parsed.data.notes : undefined;
      } catch {
        return undefined; // offline
      }
    },

    async saveText(noteId, text) {
      const parsed = syncOpSchema.safeParse({
        opId: newId(now()),
        entity: 'note',
        entityId: noteId,
        type: 'update',
        patch: { text },
        hlc: await nextHlc(db, now),
      });
      if (!parsed.success) return { ok: false, error: 'invalid' };
      const op = parsed.data;

      let res: Response;
      try {
        res = await fetch(`/api/public/notes/${encodeURIComponent(noteId)}/push`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clientId: await db.getMeta<string>('clientId'), ops: [op] }),
        });
      } catch {
        return { ok: false, error: 'offline' };
      }
      if (res.status === 404) return { ok: false, error: 'gone' };
      if (res.status === 401) return { ok: false, error: 'auth' };
      if (!res.ok) return { ok: false, error: 'server' };

      const body = pushResponseSchema.safeParse(await res.json().catch(() => undefined));
      if (!body.success) return { ok: false, error: 'server' };
      if (!body.data.accepted.includes(op.opId)) return { ok: false, error: 'rejected' };

      for (const l of listeners) l();
      return { ok: true };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
