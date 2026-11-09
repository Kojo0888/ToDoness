/**
 * Changing the text of other users' public notes (docs/notes/PRD.md FR-96, FR-107). The
 * change is queued on the device and sent by the sync engine to the note's restricted push;
 * the copy of the notes themselves is kept by `publicData`.
 */
import type { TodonessDB } from '../data/db';
import { queuePublicOp, type EditResult } from './publicEdit';

export interface PublicNotes {
  saveText(noteId: string, text: string): Promise<EditResult>;
}

export function createPublicNotes(deps: { db: TodonessDB; now?: () => number }): PublicNotes {
  const { db, now = Date.now } = deps;
  return {
    saveText: (noteId, text) =>
      queuePublicOp(
        db,
        now,
        { target: 'note', targetId: noteId },
        {
          entity: 'note',
          type: 'update',
          entityId: noteId,
          patch: { text },
        },
      ),
  };
}
