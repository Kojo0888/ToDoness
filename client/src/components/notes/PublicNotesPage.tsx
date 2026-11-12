import { useState } from 'react';
import { InfoTip } from '../common/InfoTip';
import type { PublicNote } from '@todoness/shared';
import { useOnline } from '../../app/hooks';
import { usePublicNotes } from '../../app/publicHooks';
import { publicNotes } from '../../app/container';
import { matchesSearch } from '../../lib/search';
import { t } from '../../app/strings';
import { PublicQueueNotice } from '../public/PublicQueueNotice';
import { NoteEditor } from './NoteEditor';
import { NoteSearch } from './NoteSearch';
import { formatChanged } from './NotesPage';

/**
 * Other users' public notes (docs/notes/PRD.md FR-95 – FR-97, FR-103, FR-106 – FR-110):
 * everyone edits the text, also offline; changes are queued and sent by the sync.
 */
export function PublicNotesPage() {
  const online = useOnline();
  const { value, at, failed, pending, refused } = usePublicNotes();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function saveText(id: string, text: string) {
    const result = await publicNotes.saveText(id, text);
    setError(result.ok ? null : t.notes.tooLong);
  }

  const offline = !online || failed;
  const shown = value?.filter((n) => matchesSearch([n.text, n.ownerEmail], query)) ?? [];
  return (
    <section className="notes-page" aria-labelledby="public-notes-title">
      <header className="list-head">
        <h2 id="public-notes-title">{t.notes.publicPage.title}</h2>
        <span className="badge">{t.publicPage.editable}</span>
        <InfoTip
          text={t.notes.publicPage.intro}
          label={t.common.moreInfo(t.notes.publicPage.title)}
        />
      </header>

      {value === undefined || (value === null && !failed) ? (
        <p className="empty">{t.loading}</p>
      ) : value === null ? (
        <p className="empty">{t.notes.publicPage.needsConnection}</p>
      ) : (
        <>
          <PublicQueueNotice offline={offline} at={at} pending={pending} refused={refused} />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {value.length === 0 ? (
            <p className="empty">{t.notes.publicPage.empty}</p>
          ) : (
            <NoteSearch
              value={query}
              onChange={setQuery}
              shown={shown.length}
              total={value.length}
            />
          )}
          <ul className="notes">
            {shown.map((note) => (
              <PublicNoteCard
                key={note.id}
                note={note}
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
  onSave,
}: {
  note: PublicNote;
  onSave: (text: string) => Promise<void>;
}) {
  return (
    <li className="note is-public">
      <p className="note-owner">{t.notes.publicPage.by(note.ownerEmail)}</p>
      <NoteEditor
        stored={note.text}
        label={t.notes.publicPage.noteLabel(note.ownerEmail)}
        onSave={onSave}
      />
      <div className="note-foot">
        <span className="hint note-changed">{t.notes.changed(formatChanged(note.updatedAt))}</span>
      </div>
    </li>
  );
}
