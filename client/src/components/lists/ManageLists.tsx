import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'wouter';
import type { ListModule } from '@todoness/shared';
import { getLists, getNoteLists } from '../../data/queries';
import { db, repo } from '../../app/container';
import { useDropOrder } from '../../app/hooks';
import { orderAfterDrop, resolveDrop } from '../../lib/dnd';
import { dropOrder, dropScope } from '../../lib/dropOrder';
import { t } from '../../app/strings';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ListMenu } from './ListMenu';

const REORDER_ERROR_MS = 6000;

/**
 * Rename, reorder (by dragging) and delete lists in one place. Tasks: the Inbox is fixed.
 * Notes (docs/note-lists FR-128 – FR-130): "My notes" can only be renamed, "Public notes"
 * is a locked row.
 */
export function ManageLists({ module = 'tasks' }: { module?: ListModule }) {
  const notes = module === 'notes';
  const stored = useLiveQuery(() => (notes ? getNoteLists(db) : getLists(db)), [notes], []);
  const myNotes = notes ? stored.find((l) => l.isInbox) : undefined;
  const editable = useDropOrder(
    notes ? dropScope.noteLists : dropScope.lists,
    useMemo(() => stored.filter((l) => !l.isInbox), [stored]),
  );
  const ids = editable.map((l) => l.id);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [reorderFailed, setReorderFailed] = useState(false);
  // The message goes away by itself; it is about one drop, not a lasting state.
  useEffect(() => {
    if (!reorderFailed) return;
    const timer = setTimeout(() => setReorderFailed(false), REORDER_ERROR_MS);
    return () => clearTimeout(timer);
  }, [reorderFailed]);
  const [deleting, setDeleting] = useState<{ id: string; name: string; count: number } | null>(
    null,
  );

  const sensors = useSensors(
    // Moving a few pixels starts a drag, so a plain tap on the handle is not a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const nameOf = (id: unknown) => editable.find((l) => l.id === String(id))?.name ?? '';

  async function saveName(e: FormEvent, id: string, current: string) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (trimmed && trimmed !== current) await repo.renameList(id, trimmed);
    setRenamingId(null);
  }

  async function askDelete(id: string, name: string) {
    const count = notes
      ? await db.notes.filter((n) => n.listId === id && n.deletedAt === null).count()
      : await db.todos
          .where('listId')
          .equals(id)
          .filter((x) => x.deletedAt === null)
          .count();
    setDeleting({ id, name, count });
  }

  /** The name, or the rename form while renaming. */
  const nameOrRename = (id: string, name: string, canDelete: boolean) =>
    renamingId === id ? (
      <form onSubmit={(e) => void saveName(e, id, name)} className="rename">
        <input
          type="text"
          aria-label={t.list.renameLabel}
          value={newName}
          maxLength={200}
          autoFocus
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit">{t.list.save}</button>
        <button type="button" onClick={() => setRenamingId(null)}>
          {t.list.cancel}
        </button>
      </form>
    ) : (
      <>
        <span className="manage-name">{name}</span>
        <ListMenu
          name={name}
          onRename={() => {
            setNewName(name);
            setRenamingId(id);
          }}
          onDelete={canDelete ? () => void askDelete(id, name) : undefined}
        />
      </>
    );
  const scope = notes ? dropScope.noteLists : dropScope.lists;
  const title = notes ? t.manage.notesTitle : t.manage.title;

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const action = resolveDrop({
      activeId: String(e.active.id),
      overId: e.over ? String(e.over.id) : null,
      openIds: ids,
      currentListId: '',
    });
    if (action.kind !== 'reorder') return;
    // Show the new order in the same render as the release, so the row settles where it
    // was dropped instead of jumping back first.
    const shown = orderAfterDrop(ids, action);
    if (shown) dropOrder.set(scope, shown);
    setReorderFailed(false);
    try {
      await repo.reorderList(action.todoId, action.beforeId);
    } catch {
      // E.g. the target list was deleted on another device meanwhile: put the row back now.
      if (shown) dropOrder.cancel(scope, shown);
      setReorderFailed(true);
    }
  }

  return (
    <section className="manage-lists" aria-label={title}>
      {/* App bar: round back button + title on one line (docs/note-lists FR-133, decision U1). */}
      <header className="list-head app-bar">
        <Link
          href={notes ? '/notes' : '/tasks'}
          className="icon-btn btn-back"
          aria-label={notes ? t.manage.backNotes : t.manage.back}
          title={notes ? t.manage.backNotes : t.manage.back}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path
              d="M15 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <h2>{title}</h2>
      </header>
      {myNotes && (
        <ul className="manage-list-rows fixed-rows">
          <li className="manage-row">
            <span className="drag-handle-space" aria-hidden="true" />
            {nameOrRename(myNotes.id, myNotes.name, false)}
          </li>
        </ul>
      )}
      {reorderFailed && (
        <p className="error" role="alert">
          {t.manage.reorderFailed}
        </p>
      )}

      {editable.length === 0 ? (
        notes ? null : (
          <p className="empty">{t.manage.empty}</p>
        )
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e: DragStartEvent) => setDragging(String(e.active.id))}
          onDragEnd={(e) => void onDragEnd(e)}
          onDragCancel={() => setDragging(null)}
          accessibility={{
            screenReaderInstructions: { draggable: t.manage.dragInstructions },
            announcements: {
              onDragStart: ({ active }) => t.todo.dragStart(nameOf(active.id)),
              onDragOver: ({ active, over }) =>
                over
                  ? t.todo.dragOver(nameOf(active.id), ids.indexOf(String(over.id)) + 1, ids.length)
                  : undefined,
              onDragEnd: ({ active }) => t.todo.dragDropped(nameOf(active.id)),
              onDragCancel: ({ active }) => t.todo.dragCancelled(nameOf(active.id)),
            },
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="manage-list-rows">
              {editable.map((l) => (
                <SortableRow key={l.id} id={l.id} name={l.name} ids={ids}>
                  {nameOrRename(l.id, l.name, true)}
                </SortableRow>
              ))}
            </ul>
          </SortableContext>
          <DragOverlay>
            {dragging && <div className="drag-overlay">{nameOf(dragging)}</div>}
          </DragOverlay>
        </DndContext>
      )}

      {notes && (
        <ul className="manage-list-rows fixed-rows">
          <li className="manage-row locked" title={t.manage.locked(t.notes.publicNotes)}>
            <span className="drag-handle-space" aria-hidden="true" />
            <span className="manage-name">{t.notes.publicNotes}</span>
            <span className="lock" role="img" aria-label={t.manage.lockedLabel}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                <rect
                  x="5"
                  y="11"
                  width="14"
                  height="10"
                  rx="2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M8 11V8a4 4 0 0 1 8 0v3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
            </span>
            <span className="sr-only">{t.manage.locked(t.notes.publicNotes)}</span>
          </li>
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t.list.deleteListTitle}
        confirmLabel={t.list.delete}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          const d = deleting!;
          setDeleting(null);
          await repo.deleteList(d.id);
        }}
      >
        {deleting && (
          <p>
            {notes
              ? t.notes.deleteListText(deleting.name, deleting.count)
              : t.list.deleteListText(deleting.name, deleting.count)}
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}

/** A list row with its drag handle on the left. */
function SortableRow({
  id,
  name,
  ids,
  children,
}: {
  id: string;
  name: string;
  ids: string[];
  children: React.ReactNode;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, data: { title: name, openIds: ids } });
  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  };
  return (
    <li ref={setNodeRef} style={style} className={`manage-row${isDragging ? ' is-dragging' : ''}`}>
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="drag-handle"
        aria-label={t.manage.drag(name)}
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
      {children}
    </li>
  );
}
