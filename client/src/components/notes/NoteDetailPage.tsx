import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import type { Note } from '@todoness/shared';
import { getNoteById, getNoteLists, noteListKey } from '../../data/queries';
import { db, repo } from '../../app/container';
import { t } from '../../app/strings';
import { AppBar, TrashIcon } from '../common/icons';
import { InfoTip } from '../common/InfoTip';
import { useUndoToast } from '../common/Toast';
import { NoteEditor } from './NoteEditor';
import { formatChanged } from './NotesPage';

const listPath = (listId: string | null) => (listId === null ? '/notes' : `/notes/l/${listId}`);

/**
 * One note on its own page (docs/notes-details FR-198 – FR-200): a large text box, the
 * Public switch, the last modified time and Delete. Opened from the details button of a card.
 */
export function NoteDetailPage({ noteId }: { noteId: string }) {
  // `undefined` = loading, `null` = no such note (or it was deleted on another device).
  const note = useLiveQuery(async () => (await getNoteById(db, noteId)) ?? null, [noteId]);
  const lists = useLiveQuery(() => getNoteLists(db), [], undefined);
  if (note === undefined || lists === undefined) return null;
  if (note === null) return <Redirect to="/notes" replace />;
  return <NoteDetail note={note} backTo={listPath(noteListKey(lists)(note))} />;
}

function NoteDetail({ note, backTo }: { note: Note; backTo: string }) {
  const [, navigate] = useLocation();
  const showUndo = useUndoToast();
  const [error, setError] = useState<string | null>(null);
  const hintId = `note-detail-public-hint-${note.id}`;

  async function remove() {
    await repo.deleteNote(note.id);
    navigate(backTo);
    showUndo(t.notes.deleted, () => void repo.restoreNote(note.id));
  }

  return (
    <section className="notes-page note-detail">
      <AppBar backHref={backTo} backLabel={t.notes.backToNotes} title={t.notes.detail.title} />

      <NoteEditor
        stored={note.text}
        label={t.notes.detail.textLabel}
        rows={16}
        onSave={async (text) => {
          try {
            await repo.updateNoteText(note.id, text);
            setError(null);
          } catch {
            setError(t.notes.saveFailed); // deleted meanwhile, or too long
          }
        }}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="note-detail-side">
        <label className="switch note-public">
          <input
            type="checkbox"
            role="switch"
            checked={note.isPublic}
            aria-describedby={hintId}
            onChange={(e) => void repo.setNotePublic(note.id, e.target.checked)}
          />
          {t.notes.public}
        </label>
        <InfoTip id={hintId} text={t.notes.publicHint} label={t.common.moreInfo(t.notes.public)} />
        <p className="hint note-changed">
          {t.notes.detail.lastModified(formatChanged(note.updatedAt))}
        </p>
      </div>

      <button type="button" className="danger" onClick={() => void remove()}>
        <TrashIcon /> {t.notes.delete}
      </button>
    </section>
  );
}
