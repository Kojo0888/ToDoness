import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import type { Note } from '@todoness/shared';
import { getNotes } from '../../data/queries';
import { db, repo } from '../../app/container';
import { t } from '../../app/strings';
import { useUndoToast } from '../common/Toast';
import { NoteEditor } from './NoteEditor';

export const formatChanged = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** My notes (docs/notes/PRD.md section 4.2): offline-first, like tasks. */
export function NotesPage() {
  const notes = useLiveQuery(() => getNotes(db), [], undefined);
  const [draft, setDraft] = useState('');

  async function add(e?: FormEvent) {
    e?.preventDefault();
    if (!draft.trim()) return;
    const text = draft;
    setDraft('');
    await repo.createNote(text);
  }

  return (
    <section className="notes-page" aria-labelledby="notes-title">
      <header className="list-head">
        <h2 id="notes-title">{t.notes.title}</h2>
      </header>

      <form className="note-add" onSubmit={(e) => void add(e)}>
        <textarea
          aria-label={t.notes.newLabel}
          aria-describedby="note-add-hint"
          placeholder={t.notes.newPlaceholder}
          value={draft}
          rows={3}
          maxLength={20_000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void add();
          }}
        />
        <div className="note-add-actions">
          <span id="note-add-hint" className="hint">
            {t.notes.addHint}
          </span>
          <button type="submit" className="primary" disabled={!draft.trim()}>
            {t.notes.add}
          </button>
        </div>
      </form>

      {notes !== undefined && notes.length === 0 && <p className="empty">{t.notes.empty}</p>}
      <ul className="notes">
        {notes?.map((note, i) => (
          <NoteCard key={note.id} note={note} position={i + 1} />
        ))}
      </ul>
    </section>
  );
}

function NoteCard({ note, position }: { note: Note; position: number }) {
  const showUndo = useUndoToast();
  const [error, setError] = useState<string | null>(null);
  const hintId = `note-public-hint-${note.id}`;

  async function remove() {
    await repo.deleteNote(note.id);
    showUndo(t.notes.deleted, () => void repo.restoreNote(note.id));
  }

  return (
    <li className={`note${note.isPublic ? ' is-public' : ''}`}>
      <NoteEditor
        stored={note.text}
        label={t.notes.noteLabel(position)}
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
      <div className="note-foot">
        <span className="hint">{t.notes.changed(formatChanged(note.updatedAt))}</span>
        <label className="switch" title={t.notes.publicHint}>
          <input
            type="checkbox"
            role="switch"
            checked={note.isPublic}
            aria-describedby={hintId}
            onChange={(e) => void repo.setNotePublic(note.id, e.target.checked)}
          />
          {t.notes.public}
        </label>
        <span id={hintId} className="sr-only">
          {t.notes.publicHint}
        </span>
        <button
          type="button"
          className="danger"
          aria-label={t.notes.deleteLabel(position)}
          onClick={() => void remove()}
        >
          {t.notes.delete}
        </button>
      </div>
    </li>
  );
}
