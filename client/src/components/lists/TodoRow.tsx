import { useSortable } from '@dnd-kit/sortable';
import type { Todo } from '@todoness/shared';
import type { CSSProperties } from 'react';
import { Link } from 'wouter';
import { formatDue } from '../../lib/dates';
import { repo } from '../../app/container';
import { t } from '../../app/strings';
import type { TodoDragData } from '../common/DragAndDrop';

const MARKS = ['', '!', '!!', '!!!'] as const;

/** A finished task: not draggable. */
export function TodoRow({ todo, listId }: { todo: Todo; listId: string }) {
  return <Row todo={todo} listId={listId} />;
}

/** An open task: draggable by its handle (reorder, or drop on a list in the sidebar). */
export function SortableTodoRow({
  todo,
  listId,
  openIds,
}: {
  todo: Todo;
  listId: string;
  openIds: string[];
}) {
  const data: TodoDragData = { title: todo.title, listId, openIds };
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: todo.id, data });

  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  };

  return (
    <Row
      todo={todo}
      listId={listId}
      rowRef={setNodeRef}
      style={style}
      dragging={isDragging}
      handle={
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="drag-handle"
          aria-label={t.todo.drag(todo.title)}
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
      }
    />
  );
}

function Row({
  todo,
  listId,
  handle,
  rowRef,
  style,
  dragging,
}: {
  todo: Todo;
  listId: string;
  handle?: React.ReactNode;
  rowRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  dragging?: boolean;
}) {
  return (
    <li
      ref={rowRef}
      style={style}
      className={`todo${todo.done ? ' is-done' : ''}${dragging ? ' is-dragging' : ''}`}
    >
      {handle}
      <input
        type="checkbox"
        checked={todo.done}
        aria-label={todo.done ? t.todo.markOpen(todo.title) : t.todo.markDone(todo.title)}
        onChange={(e) => void repo.setDone(todo.id, e.target.checked)}
      />
      <Link href={`/l/${listId}/t/${todo.id}`} className="todo-title">
        {todo.title}
      </Link>
      {todo.dueAt !== null && <span className="due">{formatDue(todo.dueAt)}</span>}
      {todo.priority > 0 && (
        <span className={`priority p${todo.priority}`} title={t.todo.priorities[todo.priority]}>
          {MARKS[todo.priority]}
        </span>
      )}
    </li>
  );
}
