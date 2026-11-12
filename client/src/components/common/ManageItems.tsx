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
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useDropOrder } from '../../app/hooks';
import { orderAfterDrop, resolveDrop } from '../../lib/dnd';
import { dropOrder } from '../../lib/dropOrder';
import { t } from '../../app/strings';
import { ConfirmDialog } from './ConfirmDialog';
import { ListMenu } from '../lists/ListMenu';

const REORDER_ERROR_MS = 6000;

export interface ManageItem {
  id: string;
  name: string;
}

/** The words of one Manage screen (lists, plans). */
export interface ManageText {
  title: string;
  back: string;
  empty: string;
  renameLabel: string;
  deleteItem: string;
  deleteTitle: string;
  /** `count` = what goes with it (tasks of a list, activities of a plan). */
  deleteText: (name: string, count: number) => string;
  drag: (name: string) => string;
  reorderFailed: string;
}

interface Props {
  items: ManageItem[];
  /** Name of the pending drop order (lib/dropOrder.ts). */
  scope: string;
  backHref: string;
  nameMax: number;
  text: ManageText;
  rename: (id: string, name: string) => Promise<unknown>;
  reorder: (id: string, beforeId: string | null) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  /** How many things are deleted together with the item (shown in the question). */
  countOf: (id: string) => Promise<number>;
}

/**
 * Rename, reorder (by dragging) and delete plans in one place (docs/plan/PRD.md FR-121), the
 * way Manage lists does it: one "⋯" menu per row, no help text (UI_GUIDELINES.md). Kept
 * generic (texts and actions passed in); Manage lists has its own page because of the
 * note-list rows (docs/note-lists).
 */
export function ManageItems({
  items,
  scope,
  backHref,
  nameMax,
  text,
  rename,
  reorder,
  remove,
  countOf,
}: Props) {
  const editable = useDropOrder(scope, items);
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
    if (trimmed && trimmed !== current) await rename(id, trimmed);
    setRenamingId(null);
  }

  async function askDelete(id: string, name: string) {
    setDeleting({ id, name, count: await countOf(id) });
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
    if (shown) dropOrder.set(scope, shown);
    setReorderFailed(false);
    try {
      await reorder(action.todoId, action.beforeId);
    } catch {
      // E.g. the target was deleted on another device meanwhile: put the row back now.
      if (shown) dropOrder.cancel(scope, shown);
      setReorderFailed(true);
    }
  }

  return (
    <section className="manage-lists" aria-label={text.title}>
      {/* App bar: round back button + title on one line, as Manage lists (decision U1). */}
      <header className="list-head app-bar">
        <Link
          href={backHref}
          className="icon-btn btn-back"
          aria-label={text.back}
          title={text.back}
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
        <h2>{text.title}</h2>
      </header>
      {reorderFailed && (
        <p className="error" role="alert">
          {text.reorderFailed}
        </p>
      )}

      {editable.length === 0 ? (
        <p className="empty">{text.empty}</p>
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
                <SortableRow key={l.id} id={l.id} name={l.name} ids={ids} label={text.drag(l.name)}>
                  {renamingId === l.id ? (
                    <form onSubmit={(e) => void saveName(e, l.id, l.name)} className="rename">
                      <input
                        type="text"
                        aria-label={text.renameLabel}
                        value={newName}
                        maxLength={nameMax}
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
                        deleteLabel={text.deleteItem}
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
        title={text.deleteTitle}
        confirmLabel={t.list.delete}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          const d = deleting!;
          setDeleting(null);
          await remove(d.id);
        }}
      >
        {deleting && <p>{text.deleteText(deleting.name, deleting.count)}</p>}
      </ConfirmDialog>
    </section>
  );
}

/** A row with its drag handle on the left. */
function SortableRow({
  id,
  name,
  ids,
  label,
  children,
}: {
  id: string;
  name: string;
  ids: string[];
  label: string;
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
        aria-label={label}
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
