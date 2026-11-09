import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import type { PublicTodo } from '@todoness/shared';
import { formatDue } from '../../lib/dates';
import { useDropOrder, useOnline } from '../../app/hooks';
import { dropScope } from '../../lib/dropOrder';
import { usePublicList } from '../../app/publicHooks';
import type { EditResult } from '../../services/publicEdit';
import { publicEditor } from '../../app/container';
import { t } from '../../app/strings';
import { AttachmentLinks } from '../lists/Attachments';
import type { TodoDragData } from '../common/DragAndDrop';
import { PublicQueueNotice } from './PublicQueueNotice';
import { PublicTaskDetail } from './PublicTaskDetail';
import { useUndoToast } from '../common/Toast';

const MARKS = ['', '!', '!!', '!!!'] as const;

/**
 * A public list of another user: everyone can change its tasks (FR-33), also offline: the
 * page shows the copy kept on this device with the queued changes on top (notes FR-106 – 110).
 */
export function PublicListPage({ listId, todoId }: { listId: string; todoId?: string }) {
  const online = useOnline();
  const showUndo = useUndoToast();
  const [, navigate] = useLocation();
  const { value, at, failed, pending, refused } = usePublicList(listId);
  const [showDone, setShowDone] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const loaded = value && value !== 'gone' ? value : null;
  const open = useDropOrder(
    dropScope.publicList(listId),
    loaded?.todos.filter((x) => !x.done) ?? [],
  );

  /** Queues a change; shows what went wrong, if anything (the server answers later). */
  async function act(change: Promise<EditResult>) {
    const result = await change;
    setError(result.ok ? null : t.publicPage.errors[result.error]);
    return result.ok;
  }

  const offline = !online || failed;
  if (value === undefined || (value === null && !failed)) {
    return <p className="empty">{t.loading}</p>;
  }
  if (value === null) return <p className="empty">{t.publicPage.needsConnection}</p>;
  if (value === 'gone') {
    return (
      <section className="page">
        <p className="empty">{t.publicPage.gone}</p>
        <PublicQueueNotice offline={false} at={null} pending={pending} refused={refused} />
        <Link href="/tasks">{t.publicPage.back}</Link>
      </section>
    );
  }

  const done = value.todos.filter((x) => x.done);
  const openIds = open.map((x) => x.id);
  const selected = todoId ? value.todos.find((x) => x.id === todoId) : undefined;
  if (todoId && !selected) return <Redirect to={`/public/${listId}`} replace />;

  async function add(e: FormEvent) {
    e.preventDefault();
    const text = title.trim();
    if (!text) return;
    setTitle('');
    await act(publicEditor.createTodo(listId, text, open[0]?.orderKey ?? null));
  }

  async function remove(todo: PublicTodo) {
    if (await act(publicEditor.deleteTodo(listId, todo.id))) {
      if (todoId === todo.id) navigate(`/public/${listId}`);
      showUndo(t.todo.deleted, () => void publicEditor.restoreTodo(listId, todo.id));
    }
  }

  const row = (todo: PublicTodo, sortable: boolean) => {
    const props = {
      todo,
      listId,
      disabled: false,
      onDone: (d: boolean) => void act(publicEditor.setDone(listId, todo.id, d)),
    };
    return sortable ? (
      <SortableRow key={todo.id} {...props} open={open} />
    ) : (
      <PublicRow key={todo.id} {...props} />
    );
  };

  return (
    <div className={`list-page public-page${selected ? ' has-detail' : ''}`}>
      <section className="list-main" aria-label={value.list.name}>
        <header className="list-head">
          <h2>{value.list.name}</h2>
          <span className="badge">{t.publicPage.editable}</span>
        </header>
        <p className="hint">{t.publicPage.by(value.list.ownerEmail)}</p>
        <PublicQueueNotice offline={offline} at={at} pending={pending} refused={refused} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <form className="quick-add" onSubmit={(e) => void add(e)}>
          <input
            type="text"
            aria-label={t.list.addTask}
            placeholder={t.publicPage.addTaskPlaceholder}
            value={title}
            maxLength={500}
            onChange={(e) => setTitle(e.target.value)}
          />
        </form>

        {open.length === 0 && done.length === 0 && <p className="empty">{t.publicPage.empty}</p>}
        <SortableContext items={openIds} strategy={verticalListSortingStrategy}>
          <ul className="todos">{open.map((todo) => row(todo, true))}</ul>
        </SortableContext>

        {done.length > 0 && (
          <div className="completed">
            <button
              type="button"
              className="link"
              aria-expanded={showDone}
              onClick={() => setShowDone(!showDone)}
            >
              {t.list.completed(done.length)} ·{' '}
              {showDone ? t.list.hideCompleted : t.list.showCompleted}
            </button>
            {showDone && <ul className="todos">{done.map((todo) => row(todo, false))}</ul>}
          </div>
        )}
      </section>

      {selected && (
        <PublicTaskDetail
          key={selected.id}
          listId={listId}
          todo={selected}
          disabled={false}
          act={act}
          onDelete={() => void remove(selected)}
        />
      )}
    </div>
  );
}

interface RowProps {
  todo: PublicTodo;
  listId: string;
  disabled: boolean;
  onDone: (done: boolean) => void;
}

function SortableRow({ open, ...props }: RowProps & { open: PublicTodo[] }) {
  const { todo, listId } = props;
  const data: TodoDragData = {
    title: todo.title,
    listId,
    openIds: open.map((x) => x.id),
    remote: { listId, open: open.map((x) => ({ id: x.id, orderKey: x.orderKey })) },
  };
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: todo.id, data, disabled: props.disabled });
  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  };
  return (
    <PublicRow
      {...props}
      rowRef={setNodeRef}
      style={style}
      dragging={isDragging}
      handle={
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="drag-handle"
          aria-label={t.todo.drag(todo.title)}
          disabled={props.disabled}
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

function PublicRow({
  todo,
  listId,
  disabled,
  onDone,
  handle,
  rowRef,
  style,
  dragging,
}: RowProps & {
  handle?: React.ReactNode;
  rowRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  dragging?: boolean;
}) {
  return (
    <li
      ref={rowRef}
      style={style}
      className={`todo public-todo${todo.done ? ' is-done' : ''}${dragging ? ' is-dragging' : ''}`}
    >
      {handle}
      <input
        type="checkbox"
        checked={todo.done}
        disabled={disabled}
        aria-label={todo.done ? t.todo.markOpen(todo.title) : t.todo.markDone(todo.title)}
        onChange={(e) => onDone(e.target.checked)}
      />
      <div className="public-todo-body">
        <Link href={`/public/${listId}/t/${todo.id}`} className="todo-title">
          {todo.title}
        </Link>
        {todo.notes && <p className="hint public-notes">{todo.notes}</p>}
        <AttachmentLinks attachments={todo.attachments} />
      </div>
      {todo.dueAt !== null && <span className="due">{formatDue(todo.dueAt)}</span>}
      {todo.priority > 0 && (
        <span className={`priority p${todo.priority}`} title={t.todo.priorities[todo.priority]}>
          {MARKS[todo.priority]}
        </span>
      )}
    </li>
  );
}
