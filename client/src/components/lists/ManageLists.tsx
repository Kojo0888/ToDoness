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
import { getLists } from '../../data/queries';
import { db, repo } from '../../app/container';
import { useDropOrder } from '../../app/hooks';
import { orderAfterDrop, resolveDrop } from '../../lib/dnd';
import { dropOrder, dropScope } from '../../lib/dropOrder';
import { t } from '../../app/strings';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ListMenu } from './ListMenu';

const REORDER_ERROR_MS = 6000;

/** Rename, reorder (by dragging) and delete lists in one place (the Inbox is fixed). */
export function ManageLists() {
  const stored = useLiveQuery(() => getLists(db), [], []);
  const editable = useDropOrder(
    dropScope.lists,
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
    const count = await db.todos
      .where('listId')
      .equals(id)
      .filter((x) => x.deletedAt === null)
      .count();
    setDeleting({ id, name, count });
  }

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
    if (shown) dropOrder.set(dropScope.lists, shown);
    setReorderFailed(false);
    try {
      await repo.reorderList(action.todoId, action.beforeId);
    } catch {
      // E.g. the target list was deleted on another device meanwhile: put the row back now.
      if (shown) dropOrder.cancel(dropScope.lists, shown);
      setReorderFailed(true);
    }
  }

  return (
    <section className="manage-lists" aria-label={t.manage.title}>
      <header className="list-head">
        <h2>{t.manage.title}</h2>
        <Link href="/tasks">{t.manage.back}</Link>
      </header>
      <p className="hint">{t.manage.intro}</p>
      {reorderFailed && (
        <p className="error" role="alert">
          {t.manage.reorderFailed}
        </p>
      )}

      {editable.length === 0 ? (
        <p className="empty">{t.manage.empty}</p>
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
                  {renamingId === l.id ? (
                    <form onSubmit={(e) => void saveName(e, l.id, l.name)} className="rename">
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
                      <span className="manage-name">{l.name}</span>
                      <ListMenu
                        name={l.name}
                        onRename={() => {
                          setNewName(l.name);
                          setRenamingId(l.id);
                        }}
                        onDelete={() => void askDelete(l.id, l.name)}
                      />
                    </>
                  )}
                </SortableRow>
              ))}
            </ul>
          </SortableContext>
          <DragOverlay>
            {dragging && <div className="drag-overlay">{nameOf(dragging)}</div>}
          </DragOverlay>
        </DndContext>
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
        {deleting && <p>{t.list.deleteListText(deleting.name, deleting.count)}</p>}
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
