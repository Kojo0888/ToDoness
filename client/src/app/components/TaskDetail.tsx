import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import type { Todo } from '@todoness/shared';
import { getLists, getTodoById } from '../../data/queries';
import { fromDateInput, toDateInput } from '../dates';
import { db, repo } from '../services';
import { t } from '../strings';
import { AttachmentsSection } from './Attachments';
import { useUndoToast } from './Toast';

/** Edit one task. Every change is saved at once (T3). */
export function TaskDetail({ todoId, listId }: { todoId: string; listId: string }) {
  // `null` = it does not exist (or was deleted on another device); `undefined` = still loading.
  const todo = useLiveQuery(async () => (await getTodoById(db, todoId)) ?? null, [todoId]);

  if (todo === undefined) return null;
  if (todo === null) return <Redirect to={`/l/${listId}`} replace />; // gone: back to the list
  return <TaskForm key={todo.id} todo={todo} listId={listId} />;
}

function TaskForm({ todo, listId }: { todo: Todo; listId: string }) {
  const [, navigate] = useLocation();
  const showUndo = useUndoToast();
  const lists = useLiveQuery(() => getLists(db), [], []);

  const [title, setTitle] = useState(todo.title);
  const [notes, setNotes] = useState(todo.notes);
  const [titleError, setTitleError] = useState(false);

  async function saveTitle() {
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError(true);
      setTitle(todo.title);
      return;
    }
    setTitleError(false);
    setTitle(trimmed);
    if (trimmed !== todo.title) await repo.updateTodo(todo.id, { title: trimmed });
  }

  async function remove() {
    await repo.deleteTodo(todo.id);
    navigate(`/l/${listId}`);
    showUndo(t.todo.deleted, () => void repo.restoreTodo(todo.id));
  }

  return (
    <aside className="detail" aria-label={t.todo.detail}>
      <div className="detail-head">
        <h2>{t.todo.detail}</h2>
        <button type="button" onClick={() => navigate(`/l/${listId}`)}>
          {t.todo.close}
        </button>
      </div>

      <label>
        {t.todo.title}
        <input
          type="text"
          value={title}
          maxLength={500}
          aria-invalid={titleError}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>
      {titleError && (
        <p className="error" role="alert">
          {t.todo.invalidTitle}
        </p>
      )}

      <label>
        {t.todo.notes}
        <textarea
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== todo.notes && void repo.updateTodo(todo.id, { notes })}
        />
      </label>

      <label>
        {t.todo.dueDate}
        <input
          type="date"
          value={toDateInput(todo.dueAt)}
          onChange={(e) => void repo.updateTodo(todo.id, { dueAt: fromDateInput(e.target.value) })}
        />
      </label>

      <label>
        {t.todo.priority}
        <select
          value={todo.priority}
          onChange={(e) =>
            void repo.updateTodo(todo.id, { priority: Number(e.target.value) as 0 | 1 | 2 | 3 })
          }
        >
          {t.todo.priorities.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label>
        {t.todo.list}
        <select
          value={todo.listId}
          onChange={(e) => {
            void repo.moveTodo(todo.id, e.target.value);
            navigate(`/l/${e.target.value}/t/${todo.id}`);
          }}
        >
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>

      <AttachmentsSection todoId={todo.id} />

      <button type="button" className="danger" onClick={() => void remove()}>
        {t.todo.delete}
      </button>
    </aside>
  );
}
