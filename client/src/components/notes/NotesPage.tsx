import { rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDropOrder } from '../../app/hooks';
import { dropScope } from '../../lib/dropOrder';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { NOTE_TEXT_MAX, type Note } from '@todoness/shared';
import { getNotes } from '../../data/queries';
import { matchesSearch } from '../../lib/search';
import { db, repo } from '../../app/container';
import { t } from '../../app/strings';
import type { NoteDragData } from '../common/DragAndDrop';
import { useUndoToast } from '../common/Toast';
import { NoteEditor } from './NoteEditor';
import { NoteSearch } from './NoteSearch';

export const formatChanged = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The first line of a note, for drag announcements. */
const firstLine = (text: string) => text.split('\n', 1)[0]!.slice(0, 80) || '…';

/** My notes (docs/notes/PRD.md section 4.2, 8.1, 8.2): offline-first, like tasks. */
export function NotesPage() {
  const notes = useLiveQuery(() => getNotes(db), [], undefined);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');

  async function add(e?: FormEvent) {
    e?.preventDefault();
    if (!draft.trim()) return;
    const text = draft;
    setDraft('');
    setQuery(''); // the new note must be visible (FR-104)
    await repo.createNote(text);
  }

  const searching = query.trim() !== '';
  const shown = useDropOrder(
    dropScope.notes,
    notes?.filter((n) => matchesSearch(n.text, query)) ?? [],
  );
  const ids = shown.map((n) => n.id);

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
          maxLength={NOTE_TEXT_MAX}
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

      {notes !== undefined && notes.length > 0 && (
        <NoteSearch value={query} onChange={setQuery} shown={shown.length} total={notes.length} />
      )}
      {notes !== undefined && notes.length === 0 && <p className="empty">{t.notes.empty}</p>}
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <ul className="notes">
          {shown.map((note, i) => (
            <NoteCard
              key={note.id}
              note={note}
              position={i + 1}
              ids={ids}
              dragDisabled={searching}
            />
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}

function NoteCard({
  note,
  position,
  ids,
  dragDisabled,
}: {
  note: Note;
  position: number;
  ids: string[];
  dragDisabled: boolean;
}) {
  const showUndo = useUndoToast();
  const [error, setError] = useState<string | null>(null);
  const hintId = `note-public-hint-${note.id}`;
  const data: NoteDragData = { kind: 'note', title: firstLine(note.text), openIds: ids };
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: note.id, data, disabled: dragDisabled });
  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  };

  async function remove() {
    await repo.deleteNote(note.id);
    showUndo(t.notes.deleted, () => void repo.restoreNote(note.id));
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`note${note.isPublic ? ' is-public' : ''}${isDragging ? ' is-dragging' : ''}`}
    >
      <div className="note-head">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="drag-handle"
          aria-label={t.notes.drag(position)}
          title={dragDisabled ? t.notes.dragOffWhileSearching : undefined}
          disabled={dragDisabled}
          {...attributes}
          {...listeners}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
            <path
              d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
        <span className="hint">{t.notes.changed(formatChanged(note.updatedAt))}</span>
      </div>
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
