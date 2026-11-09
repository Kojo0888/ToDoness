import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { getLists } from '../../data/queries';
import { LIST_PREFIX, orderAfterDrop, resolveDrop } from '../../lib/dnd';
import { dropOrder, dropScope } from '../../lib/dropOrder';
import type { Keyed } from '../../data/order';
import { db, publicEditor, repo } from '../../app/container';
import { t } from '../../app/strings';
import { useUndoToast } from './Toast';

/** What every draggable task tells the context about itself. */
export interface TodoDragData {
  kind?: 'todo';
  title: string;
  listId: string;
  /** Open tasks of its list in the order currently shown. */
  openIds: string[];
  /** Set for tasks of somebody else's public list: they are changed on the server. */
  remote?: { listId: string; open: Keyed[] };
}

/** A note of my notes (docs/notes/PRD.md FR-100): it can only be reordered. */
export interface NoteDragData {
  kind: 'note';
  /** The first line of the note. */
  title: string;
  /** My notes in the order currently shown. */
  openIds: string[];
}

type DragData = TodoDragData | NoteDragData;

/** Which list (for the pending order after a drop) a dragged item belongs to. */
const scopeOf = (data: DragData) =>
  data.kind === 'note'
    ? dropScope.notes
    : data.remote
      ? dropScope.publicList(data.remote.listId)
      : dropScope.list(data.listId);

/** The dragged copy glides into the row's new place, quickly. */
const DROP_ANIMATION: DropAnimation = {
  duration: 180,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.35' } } }),
};

const isListTarget = (id: unknown) => String(id).startsWith(LIST_PREFIX);

/**
 * A list under the pointer wins (moving to another list, FR-39); otherwise the
 * closest task decides the new position (FR-37). With the keyboard there is no
 * pointer, so only tasks are targets.
 */
const collisionDetection: CollisionDetection = (args) => {
  const listHit = pointerWithin(args).find((c) => isListTarget(c.id));
  if (listHit) return [listHit];
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => !isListTarget(c.id)),
  });
};

/**
 * Drag & drop for tasks (reorder inside a list, or drop on a list in the sidebar) and for my
 * notes (reorder only).
 */
export function DragAndDrop({ children }: { children: ReactNode }) {
  const showToast = useUndoToast();
  const lists = useLiveQuery(() => getLists(db), [], []);
  const [active, setActive] = useState<DragData | null>(null);
  // A task dropped on another list leaves this one: no flying back to its old place.
  const [animateDrop, setAnimateDrop] = useState(true);

  const sensors = useSensors(
    // Moving a few pixels starts a drag, so a plain tap on the handle is not a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const dataOf = (e: { active: { data: { current?: unknown } } }) =>
    e.active.data.current as DragData | undefined;
  const listName = (id: string) => lists.find((l) => l.id === id)?.name ?? '';

  function onDragStart(e: DragStartEvent) {
    setAnimateDrop(true);
    setActive(dataOf(e) ?? null);
  }

  async function onDragEnd(e: DragEndEvent) {
    const data = dataOf(e);
    setActive(null);
    if (!data) return;

    const action = resolveDrop({
      activeId: String(e.active.id),
      overId: e.over ? String(e.over.id) : null,
      openIds: data.openIds,
      currentListId: data.kind === 'note' ? '' : data.listId,
    });
    setAnimateDrop(action.kind !== 'move');
    // Show the new order in the very same render as the release (before anything is
    // written), so the row settles where it was dropped instead of jumping back first.
    const shown = orderAfterDrop(data.openIds, action);
    if (shown) dropOrder.set(scopeOf(data), shown);
    if (data.kind === 'note') {
      if (action.kind === 'reorder') await repo.reorderNote(action.todoId, action.beforeId);
      return;
    }
    if (data.remote) {
      // Somebody else's list: reordering only; it cannot be moved into one of my lists.
      if (action.kind === 'reorder') {
        await publicEditor.reorder(
          data.remote.listId,
          data.remote.open,
          action.todoId,
          action.beforeId,
        );
      }
      return;
    }
    if (action.kind === 'reorder') {
      await repo.reorderTodo(action.todoId, action.beforeId);
    } else if (action.kind === 'move') {
      await repo.moveTodo(action.todoId, action.listId);
      showToast(t.list.movedTo(listName(action.listId)), () => {
        void repo.moveTodo(action.todoId, data.listId);
      });
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={(e) => void onDragEnd(e)}
      onDragCancel={() => {
        setAnimateDrop(true);
        setActive(null);
      }}
      accessibility={{
        screenReaderInstructions: { draggable: t.todo.dragInstructions },
        announcements: {
          onDragStart: ({ active: a }) => t.todo.dragStart(dataOf({ active: a })?.title ?? ''),
          onDragOver: ({ active: a, over }) => {
            const data = dataOf({ active: a });
            if (!data || !over) return undefined;
            if (isListTarget(over.id)) {
              return t.todo.dragOverList(
                data.title,
                listName(String(over.id).slice(LIST_PREFIX.length)),
              );
            }
            const position = data.openIds.indexOf(String(over.id)) + 1;
            return t.todo.dragOver(data.title, position, data.openIds.length);
          },
          onDragEnd: ({ active: a }) => t.todo.dragDropped(dataOf({ active: a })?.title ?? ''),
          onDragCancel: ({ active: a }) => t.todo.dragCancelled(dataOf({ active: a })?.title ?? ''),
        },
      }}
    >
      {children}
      <DragOverlay dropAnimation={animateDrop ? DROP_ANIMATION : null}>
        {active && (
          <div className={`${active.kind === 'note' ? 'note' : 'todo'} drag-overlay`}>
            {active.title}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
