import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { Redirect, useLocation } from 'wouter';
import { getDoneTodos, getLists, getOpenTodos } from '../../data/queries';
import { db, repo } from '../services';
import { t } from '../strings';
import { ConfirmDialog } from './ConfirmDialog';
import { QuickAdd } from './QuickAdd';
import { TaskDetail } from './TaskDetail';
import { SortableTodoRow, TodoRow } from './TodoRow';

export function ListPage({ listId, todoId }: { listId: string; todoId?: string }) {
  const [, navigate] = useLocation();
  // `undefined` = loading, `null` = no such list (or it was deleted).
  const list = useLiveQuery(async () => {
    const l = await db.lists.get(listId);
    return l && l.deletedAt === null ? l : null;
  }, [listId]);
  const lists = useLiveQuery(() => getLists(db), [], []);
  const open = useLiveQuery(() => getOpenTodos(db, listId), [listId], []);
  const done = useLiveQuery(() => getDoneTodos(db, listId), [listId], []);

  const [showDone, setShowDone] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (list === undefined) return null;
  if (list === null) return <Redirect to="/" replace />;

  const openIds = open.map((todo) => todo.id);
  const position = lists.findIndex((l) => l.id === listId);
  const canMoveUp = position > 0 && !lists[position - 1]!.isInbox;
  const canMoveDown = position >= 0 && position < lists.length - 1;

  async function saveName(e: FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (trimmed && trimmed !== list!.name) await repo.renameList(listId, trimmed);
    setRenaming(false);
  }

  return (
    <div className={`list-page${todoId ? ' has-detail' : ''}`}>
      <section className="list-main" aria-label={list.name}>
        <header className="list-head">
          {renaming ? (
            <form onSubmit={saveName} className="rename">
              <input
                type="text"
                aria-label={t.list.renameLabel}
                value={newName}
                maxLength={200}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
              />
              <button type="submit">{t.list.save}</button>
              <button type="button" onClick={() => setRenaming(false)}>
                {t.list.cancel}
              </button>
            </form>
          ) : (
            <>
              <h2>{list.name}</h2>
              {!list.isInbox && (
                <div className="list-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setNewName(list.name);
                      setRenaming(true);
                    }}
                  >
                    {t.list.rename}
                  </button>
                  <button
                    type="button"
                    disabled={!canMoveUp}
                    onClick={() => void repo.moveList(listId, 'up')}
                  >
                    {t.list.moveUp}
                  </button>
                  <button
                    type="button"
                    disabled={!canMoveDown}
                    onClick={() => void repo.moveList(listId, 'down')}
                  >
                    {t.list.moveDown}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(true)}>
                    {t.list.deleteList}
                  </button>
                </div>
              )}
            </>
          )}
        </header>

        <label className="switch list-public">
          <input
            type="checkbox"
            role="switch"
            checked={list.isPublic}
            onChange={(e) => void repo.setListPublic(listId, e.target.checked)}
          />
          <span>
            {t.list.public}
            <span className="hint"> · {t.list.publicHint}</span>
          </span>
        </label>

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

      <ConfirmDialog
        open={confirmDelete}
        title={t.list.deleteListTitle}
        confirmLabel={t.list.delete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          await repo.deleteList(listId);
          navigate('/');
        }}
      >
        <p>{t.list.deleteListText(list.name, open.length + done.length)}</p>
      </ConfirmDialog>
    </div>
  );
}
