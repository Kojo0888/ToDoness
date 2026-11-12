import { rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDropOrder } from '../../app/hooks';
import { dropScope } from '../../lib/dropOrder';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { NOTE_TEXT_MAX, type Note } from '@todoness/shared';
import { getNoteLists, getNotesOfList } from '../../data/queries';
import { matchesSearch } from '../../lib/search';
import { db, repo } from '../../app/container';
import { t } from '../../app/strings';
import type { NoteDragData } from '../common/DragAndDrop';
import { useUndoToast } from '../common/Toast';
import { InfoTip } from '../common/InfoTip';
import { NoteEditor } from './NoteEditor';
import { NoteSearch } from './NoteSearch';
import { GripIcon } from '../common/icons';

export const formatChanged = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The first line of a note, for drag announcements. */
const firstLine = (text: string) => text.split('\n', 1)[0]!.slice(0, 80) || '…';

/**
 * A note list (docs/notes/PRD.md section 4.2, 8.1, 8.2; docs/note-lists FR-127): offline-first,
 * like tasks. `listId` null is "My notes".
 */
export function NotesPage({ listId = null }: { listId?: string | null }) {
  const notes = useLiveQuery(() => getNotesOfList(db, listId), [listId], undefined);
  const lists = useLiveQuery(() => getNoteLists(db), [], undefined);
  const list = lists?.find((l) => (listId === null ? l.isInbox : l.id === listId));
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');

  async function add(e?: FormEvent) {
    e?.preventDefault();
    if (!draft.trim()) return;
    const text = draft;
    setDraft('');
    setQuery(''); // the new note must be visible (FR-104)
    await repo.createNote(text, listId);
  }

  const searching = query.trim() !== '';
  const shown = useDropOrder(
    dropScope.notes,
    notes?.filter((n) => matchesSearch(n.text, query)) ?? [],
  );
  const ids = shown.map((n) => n.id);

  if (listId !== null && lists !== undefined && !list) {
    return <p className="empty">{t.notes.listNotFound}</p>;
  }

  return (
    <section className="notes-page" aria-labelledby="notes-title">
      <header className="list-head">
        <h2 id="notes-title">{list?.name ?? (listId === null ? t.notes.title : '')}</h2>
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
          <InfoTip
            id="note-add-hint"
            text={t.notes.addHint}
            label={t.common.moreInfo(t.notes.addAbout)}
          />
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
          <GripIcon />
        </button>
        <label className="switch note-public" title={t.notes.publicHint}>
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
      <p className="hint note-changed">{t.notes.changed(formatChanged(note.updatedAt))}</p>
    </li>
  );
}
