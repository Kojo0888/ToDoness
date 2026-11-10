import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDropOrder } from '../../app/hooks';
import { dropScope } from '../../lib/dropOrder';
import { useState } from 'react';
import { Redirect } from 'wouter';
import { getDoneTodos, getOpenTodos } from '../../data/queries';
import { db, repo } from '../../app/container';
import { t } from '../../app/strings';
import { QuickAdd } from './QuickAdd';
import { TaskDetail } from './TaskDetail';
import { SortableTodoRow, TodoRow } from './TodoRow';

export function ListPage({ listId, todoId }: { listId: string; todoId?: string }) {
  // `undefined` = loading, `null` = no such list (or it was deleted).
  const list = useLiveQuery(async () => {
    const l = await db.lists.get(listId);
    return l && l.deletedAt === null ? l : null;
  }, [listId]);
  const open = useDropOrder(
    dropScope.list(listId),
    useLiveQuery(() => getOpenTodos(db, listId), [listId], []),
  );
  const done = useLiveQuery(() => getDoneTodos(db, listId), [listId], []);

  const [showDone, setShowDone] = useState(false);

  if (list === undefined) return null;
  if (list === null) return <Redirect to="/tasks" replace />;

  const openIds = open.map((todo) => todo.id);

  return (
    <div className={`list-page${todoId ? ' has-detail' : ''}`}>
      <section className="list-main" aria-label={list.name}>
        <header className="list-head">
          <h2>{list.name}</h2>
        </header>

        <label className="switch list-public" title={t.list.publicHint}>
          <input
            type="checkbox"
            role="switch"
            checked={list.isPublic}
            aria-describedby="public-hint"
            onChange={(e) => void repo.setListPublic(listId, e.target.checked)}
          />
          {t.list.public}
        </label>
        <span id="public-hint" className="sr-only">
          {t.list.publicHint}
        </span>

        <QuickAdd listId={listId} />

        {open.length === 0 ? (
          <p className="empty">{t.list.empty}</p>
        ) : (
          <SortableContext items={openIds} strategy={verticalListSortingStrategy}>
            <ul className="todos">
              {open.map((todo) => (
                <SortableTodoRow key={todo.id} todo={todo} listId={listId} openIds={openIds} />
              ))}
            </ul>
          </SortableContext>
        )}

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
                  <TodoRow key={todo.id} todo={todo} listId={listId} />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {todoId && <TaskDetail todoId={todoId} listId={listId} />}
    </div>
  );
}
