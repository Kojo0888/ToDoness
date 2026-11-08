import { useState } from 'react';
import { Link } from 'wouter';
import type { PublicTodo } from '@todoness/shared';
import { formatDue } from '../dates';
import { usePolled } from '../hooks';
import { fetchPublicList } from '../publicApi';
import { t } from '../strings';
import { AttachmentLinks } from './Attachments';

const REFRESH_MS = 10_000;
const MARKS = ['', '!', '!!', '!!!'] as const;

/** A public list of another user: read-only (FR-33). */
export function PublicListPage({ listId }: { listId: string }) {
  const { value, failed } = usePolled(() => fetchPublicList(listId), REFRESH_MS, listId);
  const [showDone, setShowDone] = useState(false);

  if (value === undefined) {
    return <p className="empty">{failed ? t.publicPage.needsConnection : t.loading}</p>;
  }
  if (value === 'gone') {
    return (
      <section className="page">
        <p className="empty">{t.publicPage.gone}</p>
        <Link href="/">{t.publicPage.back}</Link>
      </section>
    );
  }

  const open = value.todos.filter((x) => !x.done);
  const done = value.todos.filter((x) => x.done);

  return (
    <section className="page public-page" aria-label={value.list.name}>
      <header className="list-head">
        <h2>{value.list.name}</h2>
        <span className="badge">{t.publicPage.readOnly}</span>
      </header>
      <p className="hint">{t.publicPage.by(value.list.ownerEmail)}</p>
      {failed && <p className="notice">{t.publicPage.needsConnection}</p>}

      {open.length === 0 && done.length === 0 && <p className="empty">{t.publicPage.empty}</p>}
      <ul className="todos">
        {open.map((todo) => (
          <PublicTodoRow key={todo.id} todo={todo} />
        ))}
      </ul>

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
          {showDone && (
            <ul className="todos">
              {done.map((todo) => (
                <PublicTodoRow key={todo.id} todo={todo} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function PublicTodoRow({ todo }: { todo: PublicTodo }) {
  return (
    <li className={`todo public-todo${todo.done ? ' is-done' : ''}`}>
      <input type="checkbox" checked={todo.done} disabled readOnly aria-label={todo.title} />
      <div className="public-todo-body">
        <span className="todo-title">{todo.title}</span>
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
