import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Link, useLocation } from 'wouter';
import { listDropId } from '../../lib/dnd';
import { getLists } from '../../data/queries';
import { useOnline, usePolled } from '../../app/hooks';
import { fetchPublicLists } from '../../services/publicApi';
import { db, repo } from '../../app/container';
import type { StoredUser } from '../../services/session';
import { t } from '../../app/strings';
import { SyncBadge } from './SyncBadge';

interface Props {
  user: StoredUser;
  open: boolean;
  onNavigate: () => void;
}

export function Sidebar({ user, open, onNavigate }: Props) {
  const [location, navigate] = useLocation();
  const lists = useLiveQuery(() => getLists(db), [], []);
  const [name, setName] = useState('');
  const online = useOnline();
  const publicLists = usePolled(fetchPublicLists, 5000);

  async function addList(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setName('');
    const list = await repo.createList(trimmed);
    navigate(`/l/${list.id}`);
    onNavigate();
  }

  const active = (href: string) => location === href || location.startsWith(`${href}/`);

  return (
    <nav className={`sidebar${open ? ' open' : ''}`} aria-label={t.nav.lists}>
      <h1 className="brand">{t.appName}</h1>
      <div className="nav-scroll">
        <ul className="nav-lists">
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

        {(publicLists.value?.length ?? 0) > 0 && (
          <>
            <h2 className="nav-heading">{t.nav.publicLists}</h2>
            <ul className="nav-lists" aria-label={t.nav.publicLists}>
              {publicLists.value?.map((l) => (
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
        {!online && publicLists.value === undefined && (
          <p className="hint nav-note">{t.nav.publicNeedsConnection}</p>
        )}

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
