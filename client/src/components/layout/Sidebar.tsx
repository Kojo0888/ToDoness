import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Link, useLocation } from 'wouter';
import { listDropId } from '../../lib/dnd';
import { MANAGE_LISTS_PATH } from '../../lib/listManage';
import { getLists, getNotes } from '../../data/queries';
import { useModule } from '../../app/hooks';
import { usePublicLists, usePublicNotes } from '../../app/publicHooks';
import { db, repo } from '../../app/container';
import type { StoredUser } from '../../services/session';
import { t } from '../../app/strings';
import { ModuleSwitch } from './ModuleSwitch';
import { SyncBadge } from './SyncBadge';

interface Props {
  user: StoredUser;
  open: boolean;
  onNavigate: () => void;
}

export function Sidebar({ user, open, onNavigate }: Props) {
  const [location] = useLocation();
  const { current } = useModule();
  const active = (href: string) => location === href || location.startsWith(`${href}/`);

  return (
    <nav className={`sidebar${open ? ' open' : ''}`} aria-label={t.nav.main}>
      <h1 className="brand">{t.appName}</h1>
      <ModuleSwitch onNavigate={onNavigate} />
      <div className="nav-scroll">
        {current === 'notes' ? (
          <NotesNav location={location} onNavigate={onNavigate} />
        ) : (
          <TasksNav active={active} onNavigate={onNavigate} />
        )}
      </div>

      <div className="nav-foot">
        <SyncBadge admin={user.role === 'admin'} />
        <Link href="/settings" onClick={onNavigate} className={active('/settings') ? 'active' : ''}>
          {t.nav.settings}
        </Link>
        {user.role === 'admin' && (
          <Link href="/admin" onClick={onNavigate} className={active('/admin') ? 'active' : ''}>
            {t.nav.admin}
          </Link>
        )}
      </div>
    </nav>
  );
}

/** The Tasks module: the user's lists, other users' public lists, a new list. */
function TasksNav({
  active,
  onNavigate,
}: {
  active: (href: string) => boolean;
  onNavigate: () => void;
}) {
  const [, navigate] = useLocation();
  const lists = useLiveQuery(() => getLists(db), [], []);
  const [name, setName] = useState('');
  const { lists: publicLists, failed: publicFailed } = usePublicLists();

  async function addList(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setName('');
    const list = await repo.createList(trimmed);
    navigate(`/l/${list.id}`);
    onNavigate();
  }

  return (
    <>
      <ul className="nav-lists" aria-label={t.nav.lists}>
        {lists.map((l) => (
          <ListLink
            key={l.id}
            id={l.id}
            name={l.name}
            active={active(`/l/${l.id}`)}
            onNavigate={onNavigate}
          />
        ))}
      </ul>

      {(publicLists?.length ?? 0) > 0 && (
        <>
          <h2 className="nav-heading">{t.nav.publicLists}</h2>
          <ul className="nav-lists" aria-label={t.nav.publicLists}>
            {publicLists?.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/public/${l.id}`}
                  className={active(`/public/${l.id}`) ? 'active' : ''}
                  aria-current={active(`/public/${l.id}`) ? 'page' : undefined}
                  onClick={onNavigate}
                  title={l.ownerEmail}
                >
                  {l.name}
                  <span className="nav-owner">{l.ownerEmail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {publicLists === null && publicFailed && (
        <p className="hint nav-note">{t.nav.publicNeedsConnection}</p>
      )}

      <Link
        href={MANAGE_LISTS_PATH}
        onClick={onNavigate}
        className={`btn btn-block manage-lists-link${active(MANAGE_LISTS_PATH) ? ' active' : ''}`}
        aria-current={active(MANAGE_LISTS_PATH) ? 'page' : undefined}
      >
        <span aria-hidden="true" className="btn-icon">
          ☰
        </span>
        {t.nav.manageLists}
      </Link>

      <form onSubmit={addList} className="new-list">
        <input
          type="text"
          aria-label={t.nav.newList}
          placeholder={t.nav.newList}
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit">{t.nav.addList}</button>
      </form>
    </>
  );
}

/** The Notes module: my notes and other users' public notes, with counts. */
function NotesNav({ location, onNavigate }: { location: string; onNavigate: () => void }) {
  const mine = useLiveQuery(async () => (await getNotes(db)).length, [], 0);
  // The public notes page refreshes them itself; here only the copy is read then.
  const shared = usePublicNotes({ refresh: location !== '/notes/public' });

  const link = (href: string, label: string, count: number | undefined, tooltip?: string) => {
    const isActive = location === href || location === `${href}/`;
    return (
      <li>
        <Link
          href={href}
          className={isActive ? 'active' : ''}
          aria-current={isActive ? 'page' : undefined}
          onClick={onNavigate}
          title={tooltip}
        >
          {label}
          {count !== undefined && <span className="nav-count">{count}</span>}
          {tooltip && (
            <span className="nav-info" aria-hidden="true">
              ⓘ
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <>
      <ul className="nav-lists" aria-label={t.modules.notes}>
        {link('/notes', t.notes.myNotes, mine)}
        {link(
          '/notes/public',
          t.notes.publicNotes,
          shared.value?.length,
          // Not on this device yet: said in a tooltip rather than a line in the sidebar.
          shared.value === null && shared.failed ? t.notes.publicNeedsConnection : undefined,
        )}
      </ul>
    </>
  );
}

/** A sidebar list: a link, and a place where a dragged task can be dropped (FR-39). */
function ListLink({
  id,
  name,
  active,
  onNavigate,
}: {
  id: string;
  name: string;
  active: boolean;
  onNavigate: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: listDropId(id) });
  return (
    <li ref={setNodeRef} className={isOver ? 'drop-target' : undefined}>
      <Link
        href={`/l/${id}`}
        className={active ? 'active' : ''}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
      >
        {name}
      </Link>
    </li>
  );
}
