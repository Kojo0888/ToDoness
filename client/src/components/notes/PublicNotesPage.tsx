import { useEffect, useState } from 'react';
import type { PublicNote } from '@todoness/shared';
import { useOnline, usePolled } from '../../app/hooks';
import { publicNotes } from '../../app/container';
import { t } from '../../app/strings';
import { NoteEditor } from './NoteEditor';
import { formatChanged } from './NotesPage';

const REFRESH_MS = 5000;

/** Other users' public notes (docs/notes/PRD.md FR-95 – FR-97): online, everyone edits. */
export function PublicNotesPage() {
  const online = useOnline();
  const { value, failed, reload } = usePolled(() => publicNotes.list(), REFRESH_MS, 'notes');
  const [error, setError] = useState<string | null>(null);

  /** Saves a text; shows what went wrong (the note may be gone, so not on the card). */
  async function saveText(id: string, text: string) {
    const result = await publicNotes.saveText(id, text);
    if (result.ok) return setError(null);
    setError(
      result.error === 'gone' ? t.publicPage.notePrivate : t.publicPage.errors[result.error],
    );
    reload();
  }

  // Every accepted change reloads the notes at once.
  useEffect(() => publicNotes.subscribe(reload), [reload]);

  const offline = !online || failed;
  return (
    <section className="notes-page" aria-labelledby="public-notes-title">
      <header className="list-head">
        <h2 id="public-notes-title">{t.notes.publicPage.title}</h2>
        <span className="badge">{t.publicPage.editable}</span>
      </header>
      <p className="hint">{t.notes.publicPage.intro}</p>

      {value === undefined ? (
        <p className="empty">{failed ? t.notes.publicPage.needsConnection : t.loading}</p>
      ) : (
        <>
          {offline && <p className="notice">{t.notes.publicPage.editsNeedConnection}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {value.length === 0 && <p className="empty">{t.notes.publicPage.empty}</p>}
          <ul className="notes">
            {value.map((note) => (
              <PublicNoteCard
                key={note.id}
                note={note}
                disabled={offline}
                onSave={(text) => saveText(note.id, text)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function PublicNoteCard({
  note,
  disabled,
  onSave,
}: {
  note: PublicNote;
  disabled: boolean;
  onSave: (text: string) => Promise<void>;
}) {
  return (
    <li className="note is-public">
      <p className="note-owner">{t.notes.publicPage.by(note.ownerEmail)}</p>
      <NoteEditor
        stored={note.text}
        label={t.notes.publicPage.noteLabel(note.ownerEmail)}
        disabled={disabled}
        onSave={onSave}
      />
      <div className="note-foot">
        <span className="hint">{t.notes.changed(formatChanged(note.updatedAt))}</span>
      </div>
    </li>
  );
}
