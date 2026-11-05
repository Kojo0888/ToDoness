import type { Todo } from '@todoness/shared';
import { Link } from 'wouter';
import { formatDue } from '../dates';
import { repo } from '../services';
import { t } from '../strings';

const MARKS = ['', '!', '!!', '!!!'] as const;

export function TodoRow({ todo, listId }: { todo: Todo; listId: string }) {
  return (
    <li className={`todo${todo.done ? ' is-done' : ''}`}>
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
