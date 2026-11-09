import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ChangeEvent } from 'react';
import { Redirect, useLocation } from 'wouter';
import type { RemindBefore, Todo } from '@todoness/shared';
import { getLists, getTodoById } from '../../data/queries';
import { fromDateTimeInput, toDateInput, toTimeInput } from '../dates';
import { enablePush } from '../push';
import { notificationSupport, requestNotificationPermission } from '../reminders';
import { db, reminders, repo } from '../services';
import { t } from '../strings';
import { AttachmentsSection } from './Attachments';
import { TimeField } from './TimeField';
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

  const [support, setSupport] = useState(() => notificationSupport());

  /** Changing the date keeps the time of day; clearing it also ends the reminder (FR-44). */
  async function changeDate(e: ChangeEvent<HTMLInputElement>) {
    const dueAt = fromDateTimeInput(e.target.value, toTimeInput(todo.dueAt));
    await repo.updateTodo(
      todo.id,
      dueAt === null ? { dueAt: null, remindBefore: null } : { dueAt },
    );
    void reminders.check();
  }

  async function changeTime(time: string) {
    if (todo.dueAt === null) return;
    const dueAt = fromDateTimeInput(toDateInput(todo.dueAt), time);
    if (dueAt !== null) await repo.updateTodo(todo.id, { dueAt });
    void reminders.check();
  }

  async function changeReminder(e: ChangeEvent<HTMLSelectElement>) {
    const value = (e.target.value || null) as RemindBefore | null;
    // Asking for permission has to happen right away, inside the click.
    // (and, once allowed, subscribe this device to web push so it also works when closed)
    const asked = value
      ? requestNotificationPermission().then(async (s) => {
          if (s === 'granted') void enablePush();
          return s;
        })
      : undefined;
    await repo.updateTodo(todo.id, { remindBefore: value });
    if (asked) setSupport(await asked);
    void reminders.check();
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

      <div className="due-row">
        <label>
          {t.todo.dueDate}
          <input type="date" value={toDateInput(todo.dueAt)} onChange={(e) => void changeDate(e)} />
        </label>
        <TimeField
          value={toTimeInput(todo.dueAt)}
          disabled={todo.dueAt === null}
          onChange={(v) => void changeTime(v)}
        />
      </div>

      <label>
        {t.todo.remind}
        <select
          value={todo.remindBefore ?? ''}
          disabled={todo.dueAt === null}
          aria-describedby="remind-hint"
          onChange={(e) => void changeReminder(e)}
        >
          <option value="">{t.todo.reminders.none}</option>
          <option value="week">{t.todo.reminders.week}</option>
          <option value="day">{t.todo.reminders.day}</option>
          <option value="hour">{t.todo.reminders.hour}</option>
        </select>
      </label>
      <p id="remind-hint" className="hint">
        {todo.dueAt === null
          ? t.todo.remindNeedsDue
          : todo.remindBefore === null
            ? ''
            : t.todo.remindHints[support]}
      </p>

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
