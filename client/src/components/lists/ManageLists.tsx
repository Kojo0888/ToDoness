import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { LIST_NAME_MAX, type ListModule } from '@todoness/shared';
import { getLists, getNoteLists } from '../../data/queries';
import { db, repo } from '../../app/container';
import { dropScope } from '../../lib/dropOrder';
import { t } from '../../app/strings';
import { ManageItems, type ManageText } from '../common/ManageItems';
import { LockIcon } from '../common/icons';

const TASK_TEXT: ManageText = {
  title: t.manage.title,
  back: t.manage.back,
  empty: t.manage.empty,
  renameLabel: t.list.renameLabel,
  deleteTitle: t.list.deleteListTitle,
  deleteText: t.list.deleteListText,
  drag: t.manage.drag,
  reorderFailed: t.manage.reorderFailed,
};

/** Note lists: no empty message, "My notes" and "Public notes" are always there. */
const NOTE_TEXT: ManageText = {
  ...TASK_TEXT,
  title: t.manage.notesTitle,
  back: t.manage.backNotes,
  empty: undefined,
  deleteText: t.notes.deleteListText,
};

/** Live tasks of a task list, or live notes of a note list: deleted with it. */
const countTodos = (id: string) =>
  db.todos
    .where('listId')
    .equals(id)
    .filter((x) => x.deletedAt === null)
    .count();
const countNotes = (id: string) =>
  db.notes.filter((n) => n.listId === id && n.deletedAt === null).count();

/**
 * Rename, reorder (by dragging) and delete lists in one place. Tasks: the Inbox is fixed and
 * not shown. Notes (docs/note-lists FR-128 – FR-130): "My notes" can only be renamed,
 * "Public notes" is a locked row.
 */
export function ManageLists({ module = 'tasks' }: { module?: ListModule }) {
  const notes = module === 'notes';
  const stored = useLiveQuery(() => (notes ? getNoteLists(db) : getLists(db)), [notes], []);
  const items = useMemo(() => stored.filter((l) => !l.isInbox), [stored]);
  return (
    <ManageItems
      items={items}
      scope={notes ? dropScope.noteLists : dropScope.lists}
      backHref={notes ? '/notes' : '/tasks'}
      nameMax={LIST_NAME_MAX}
      text={notes ? NOTE_TEXT : TASK_TEXT}
      rename={repo.renameList}
      reorder={repo.reorderList}
      remove={repo.deleteList}
      countOf={notes ? countNotes : countTodos}
      fixed={notes ? stored.find((l) => l.isInbox) : undefined}
      after={notes && <PublicNotesRow />}
    />
  );
}

/** "Public notes" in Manage note lists: shown, but cannot be changed (FR-130). */
function PublicNotesRow() {
  const name = t.notes.publicNotes;
  return (
    <ul className="manage-list-rows fixed-rows">
      <li className="manage-row locked" title={t.manage.locked(name)}>
        <span className="drag-handle-space" aria-hidden="true" />
        <span className="manage-name">{name}</span>
        <span className="lock" role="img" aria-label={t.manage.lockedLabel}>
          <LockIcon />
        </span>
        <span className="sr-only">{t.manage.locked(name)}</span>
      </li>
    </ul>
  );
}
