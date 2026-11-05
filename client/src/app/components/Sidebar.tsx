import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { getLists } from '../../data/queries';
import { db, repo } from '../services';
import type { StoredUser } from '../session';
import { t } from '../strings';
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
      <ul className="nav-lists">
        {lists.map((l) => (
          <li key={l.id}>
            <Link
              href={`/l/${l.id}`}
              className={active(`/l/${l.id}`) ? 'active' : ''}
              aria-current={active(`/l/${l.id}`) ? 'page' : undefined}
              onClick={onNavigate}
            >
              {l.name}
            </Link>
          </li>
        ))}
      </ul>

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

      <div className="nav-foot">
        <SyncBadge />
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
