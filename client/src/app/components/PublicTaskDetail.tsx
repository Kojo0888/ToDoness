import { useState, type ChangeEvent } from 'react';
import { useLocation } from 'wouter';
import type { PublicTodo } from '@todoness/shared';
import { fromDateTimeInput, toDateInput, toTimeInput } from '../dates';
import type { EditResult } from '../publicEdit';
import { publicEditor } from '../services';
import { t } from '../strings';
import { AttachmentsSection } from './Attachments';

/** Edit one task of a public list; every change is saved at once (FR-33). */
export function PublicTaskDetail({
  listId,
  todo,
  disabled,
  act,
  onDelete,
}: {
  listId: string;
  todo: PublicTodo;
  disabled: boolean;
  act: (change: Promise<EditResult>) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [, navigate] = useLocation();
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
    if (trimmed !== todo.title)
      await act(publicEditor.updateTodo(listId, todo.id, { title: trimmed }));
  }

  function changeDate(e: ChangeEvent<HTMLInputElement>) {
    const dueAt = fromDateTimeInput(e.target.value, toTimeInput(todo.dueAt));
    void act(publicEditor.updateTodo(listId, todo.id, { dueAt }));
  }

  function changeTime(e: ChangeEvent<HTMLInputElement>) {
    if (todo.dueAt === null) return;
    const dueAt = fromDateTimeInput(toDateInput(todo.dueAt), e.target.value);
    if (dueAt !== null) void act(publicEditor.updateTodo(listId, todo.id, { dueAt }));
  }

  return (
    <aside className="detail" aria-label={t.todo.detail}>
      <div className="detail-head">
        <h2>{t.todo.detail}</h2>
        <button type="button" onClick={() => navigate(`/public/${listId}`)}>
          {t.todo.close}
        </button>
      </div>
      <p className="hint">{t.publicPage.ownerNote}</p>

      <label>
        {t.todo.title}
        <input
          type="text"
          value={title}
          maxLength={500}
          disabled={disabled}
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
          disabled={disabled}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() =>
            notes !== todo.notes && void act(publicEditor.updateTodo(listId, todo.id, { notes }))
          }
        />
      </label>

      <div className="due-row">
        <label>
          {t.todo.dueDate}
          <input
            type="date"
            value={toDateInput(todo.dueAt)}
            disabled={disabled}
            onChange={changeDate}
          />
        </label>
        <label>
          {t.todo.dueTime}
          <input
            type="time"
            value={toTimeInput(todo.dueAt)}
            disabled={disabled || todo.dueAt === null}
            onChange={changeTime}
          />
        </label>
      </div>

      <label>
        {t.todo.priority}
        <select
          value={todo.priority}
          disabled={disabled}
          onChange={(e) =>
            void act(
              publicEditor.updateTodo(listId, todo.id, {
                priority: Number(e.target.value) as 0 | 1 | 2 | 3,
              }),
            )
          }
        >
          {t.todo.priorities.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <AttachmentsSection todoId={todo.id} />

      <button type="button" className="danger" disabled={disabled} onClick={onDelete}>
        {t.todo.delete}
      </button>
    </aside>
  );
}
