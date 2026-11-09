import { useState, type FormEvent } from 'react';
import { repo } from '../../app/container';
import { t } from '../../app/strings';

/** Type a title and press Enter (T1). */
export function QuickAdd({ listId }: { listId: string }) {
  const [title, setTitle] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setTitle('');
    await repo.createTodo({ listId, title: trimmed });
  }

  return (
    <form onSubmit={add} className="quick-add">
      <input
        type="text"
        aria-label={t.list.addTask}
        placeholder={t.list.addTaskPlaceholder}
        value={title}
        maxLength={500}
        onChange={(e) => setTitle(e.target.value)}
      />
    </form>
  );
}
