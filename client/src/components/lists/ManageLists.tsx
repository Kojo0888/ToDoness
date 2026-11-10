import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { getLists } from '../../data/queries';
import { db, repo } from '../../app/container';
import { moveAvailability } from '../../lib/listManage';
import { t } from '../../app/strings';
import { ConfirmDialog } from '../common/ConfirmDialog';

/** Rename, reorder and delete lists in one place (the Inbox is fixed). */
export function ManageLists() {
  const lists = useLiveQuery(() => getLists(db), [], []);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<{ id: string; name: string; count: number } | null>(
    null,
  );

  async function saveName(e: FormEvent, id: string, current: string) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (trimmed && trimmed !== current) await repo.renameList(id, trimmed);
    setRenamingId(null);
  }

  async function askDelete(id: string, name: string) {
    const count = await db.todos
      .where('listId')
      .equals(id)
      .filter((x) => x.deletedAt === null)
      .count();
    setDeleting({ id, name, count });
  }

  const editable = lists.filter((l) => !l.isInbox);

  return (
    <section className="manage-lists" aria-label={t.manage.title}>
      <header className="list-head">
        <h2>{t.manage.title}</h2>
        <Link href="/tasks">{t.manage.back}</Link>
      </header>
      <p className="hint">{t.manage.intro}</p>

      {editable.length === 0 ? (
        <p className="empty">{t.manage.empty}</p>
      ) : (
        <ul className="manage-list-rows">
          {editable.map((l) => {
            const move = moveAvailability(lists, l.id);
            return (
              <li key={l.id} className="manage-row">
                {renamingId === l.id ? (
                  <form onSubmit={(e) => void saveName(e, l.id, l.name)} className="rename">
                    <input
                      type="text"
                      aria-label={t.list.renameLabel}
                      value={newName}
                      maxLength={200}
                      autoFocus
                      onChange={(e) => setNewName(e.target.value)}
                    />
                    <button type="submit">{t.list.save}</button>
                    <button type="button" onClick={() => setRenamingId(null)}>
                      {t.list.cancel}
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="manage-name">{l.name}</span>
                    <div className="list-actions">
                      <button
                        type="button"
                        aria-label={`${t.list.rename}: ${l.name}`}
                        onClick={() => {
                          setNewName(l.name);
                          setRenamingId(l.id);
                        }}
                      >
                        {t.list.rename}
                      </button>
                      <button
                        type="button"
                        aria-label={`${t.list.moveUp}: ${l.name}`}
                        disabled={!move.up}
                        onClick={() => void repo.moveList(l.id, 'up')}
                      >
                        {t.list.moveUp}
                      </button>
                      <button
                        type="button"
                        aria-label={`${t.list.moveDown}: ${l.name}`}
                        disabled={!move.down}
                        onClick={() => void repo.moveList(l.id, 'down')}
                      >
                        {t.list.moveDown}
                      </button>
                      <button
                        type="button"
                        aria-label={`${t.list.deleteList}: ${l.name}`}
                        onClick={() => void askDelete(l.id, l.name)}
                      >
                        {t.list.deleteList}
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t.list.deleteListTitle}
        confirmLabel={t.list.delete}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          const d = deleting!;
          setDeleting(null);
          await repo.deleteList(d.id);
        }}
      >
        {deleting && <p>{t.list.deleteListText(deleting.name, deleting.count)}</p>}
      </ConfirmDialog>
    </section>
  );
}
