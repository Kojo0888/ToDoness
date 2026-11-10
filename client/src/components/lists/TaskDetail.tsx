import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Redirect, useLocation } from 'wouter';
import { REMIND_ORDER, type RemindBefore, type Todo } from '@todoness/shared';
import { getLists, getTodoById } from '../../data/queries';
import { fromDateTimeInput, toDateInput, toTimeInput } from '../../lib/dates';
import { enablePush } from '../../services/push';
import { notificationSupport, requestNotificationPermission } from '../../services/reminders';
import { db, reminders, repo } from '../../app/container';
import { t } from '../../app/strings';
import { AttachmentsSection } from './Attachments';
import { TimeField } from '../common/TimeField';
import { useUndoToast } from '../common/Toast';

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

  // The due moment as last chosen here. A date and then a time picked in quick succession
  // must combine, even before the first change has come back from the database.
  const due = useRef(todo.dueAt);
  useEffect(() => {
    due.current = todo.dueAt; // a saved change, also from another device
  }, [todo.dueAt]);

  /** Changing the date keeps the time of day; clearing it also ends the reminder (FR-44). */
  async function changeDate(e: ChangeEvent<HTMLInputElement>) {
    const dueAt = fromDateTimeInput(e.target.value, toTimeInput(due.current));
    due.current = dueAt;
    if (dueAt === null) setPendingRemind([]);
    await repo.updateTodo(todo.id, dueAt === null ? { dueAt: null, remindBefore: [] } : { dueAt });
    void reminders.check();
  }

  async function changeTime(time: string) {
    if (due.current === null) return;
    const dueAt = fromDateTimeInput(toDateInput(due.current), time);
    due.current = dueAt;
    if (dueAt !== null) await repo.updateTodo(todo.id, { dueAt });
    void reminders.check();
  }

  // A reminder change that is not saved yet. Shown instead of the saved value until that
  // catches up, so two quick taps both count and nothing flickers back in between.
  const [pendingRemind, setPendingRemind] = useState<RemindBefore[] | null>(null);
  if (pendingRemind && pendingRemind.join() === todo.remindBefore.join()) setPendingRemind(null);
  const remind = pendingRemind ?? todo.remindBefore;

  /** Turns one reminder on or off; any combination is allowed (FR-112). */
  async function toggleReminder(choice: RemindBefore) {
    const on = !remind.includes(choice);
    const next = on
      ? REMIND_ORDER.filter((r) => r === choice || remind.includes(r))
      : remind.filter((r) => r !== choice);
    setPendingRemind(next);
    // Asking for permission has to happen right away, inside the click.
    // (and, once allowed, subscribe this device to web push so it also works when closed)
    const asked = on
      ? requestNotificationPermission().then(async (s) => {
          if (s === 'granted') void enablePush();
          return s;
        })
      : undefined;
    await repo.updateTodo(todo.id, { remindBefore: next }).catch((err: unknown) => {
      setPendingRemind(null);
      throw err;
    });
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

      <div className="field">
        <span id="remind-label" className="field-label">
          {t.todo.remind}
        </span>
        <div
          className="chip-group"
          role="group"
          aria-labelledby="remind-label"
          aria-describedby="remind-hint"
        >
          {REMIND_ORDER.map((choice) => {
            const on = remind.includes(choice);
            return (
              <button
                key={choice}
                type="button"
                className={`chip${on ? ' is-selected' : ''}`}
                aria-pressed={on}
                disabled={todo.dueAt === null}
                onClick={() => void toggleReminder(choice)}
              >
                {t.todo.reminders[choice]}
              </button>
            );
          })}
        </div>
      </div>
      <p id="remind-hint" className="hint">
        {todo.dueAt === null
          ? t.todo.remindNeedsDue
          : remind.length === 0
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
