import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Redirect, Route, Switch } from 'wouter';
import { getInbox } from '../../data/queries';
import { db } from '../services';
import type { StoredUser } from '../session';
import { t } from '../strings';
import { Admin } from './Admin';
import { ListPage } from './ListPage';
import { Settings } from './Settings';
import { Sidebar } from './Sidebar';
import { ToastProvider } from './Toast';

function Home() {
  const inbox = useLiveQuery(async () => (await getInbox(db)) ?? null, []);
  if (!inbox) return <p className="empty">{inbox === null ? t.list.notFound : t.loading}</p>;
  return <Redirect to={`/l/${inbox.id}`} replace />;
}

/** The app once someone is logged in: sidebar plus the selected page. */
export function Shell({ user }: { user: StoredUser }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <ToastProvider>
      <div className="shell">
        <button
          type="button"
          className="menu-button"
          aria-label={t.nav.menu}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          ☰
        </button>
        <Sidebar user={user} open={menuOpen} onNavigate={() => setMenuOpen(false)} />
        <main className="content">
          <Switch>
            <Route path="/l/:listId/t/:todoId">
              {(p) => <ListPage key={p.listId} listId={p.listId} todoId={p.todoId} />}
            </Route>
            <Route path="/l/:listId">{(p) => <ListPage key={p.listId} listId={p.listId} />}</Route>
            <Route path="/settings">
              <Settings user={user} />
            </Route>
            <Route path="/admin">
              {user.role === 'admin' ? <Admin user={user} /> : <Redirect to="/" replace />}
            </Route>
            <Route>
              <Home />
            </Route>
          </Switch>
        </main>
      </div>
    </ToastProvider>
  );
}
