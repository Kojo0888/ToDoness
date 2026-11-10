import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Redirect, Route, Switch } from 'wouter';
import { getInbox } from '../../data/queries';
import { browserStorage, homeOf, readLastModule } from '../../lib/modules';
import { db } from '../../app/container';
import type { StoredUser } from '../../services/session';
import { t } from '../../app/strings';
import { Admin } from '../account/Admin';
import { DragAndDrop } from '../common/DragAndDrop';
import { ListPage } from '../lists/ListPage';
import { NotesPage } from '../notes/NotesPage';
import { PublicNotesPage } from '../notes/PublicNotesPage';
import { PublicListPage } from '../public/PublicListPage';
import { Reminders } from '../account/Reminders';
import { RecoveryDialog } from '../account/RecoveryDialog';
import { Settings } from '../account/Settings';
import { ModuleSwitch } from './ModuleSwitch';
import { ManageLists } from '../lists/ManageLists';
import { Sidebar } from './Sidebar';
import { ToastProvider } from '../common/Toast';

/** The start address: opens the module used last on this device (FR-86). */
function Start() {
  return <Redirect to={homeOf(readLastModule(browserStorage()))} replace />;
}

/** The start of the Tasks module: the Inbox. */
function Home() {
  const inbox = useLiveQuery(async () => (await getInbox(db)) ?? null, []);
  if (!inbox) return <p className="empty">{inbox === null ? t.list.notFound : t.loading}</p>;
  return <Redirect to={`/l/${inbox.id}`} replace />;
}

/** The app once someone is logged in: sidebar plus the selected page. */
export function Shell({ user }: { user: StoredUser }) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <ToastProvider>
      <DragAndDrop>
        <div className="shell">
          <header className="topbar">
            <button
              type="button"
              className="menu-button"
              aria-label={t.nav.menu}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
                <path
                  d="M4 6h16M4 12h16M4 18h16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <span className="topbar-title">{t.appName}</span>
            <ModuleSwitch />
          </header>
          {menuOpen && (
            <button
              type="button"
              className="scrim"
              tabIndex={-1}
              aria-label={t.nav.menu}
              onClick={() => setMenuOpen(false)}
            />
          )}
          <RecoveryDialog />
          <Sidebar user={user} open={menuOpen} onNavigate={() => setMenuOpen(false)} />
          <main className="content">
            <Reminders />
            <Switch>
              <Route path="/l/:listId/t/:todoId">
                {(p) => <ListPage key={p.listId} listId={p.listId} todoId={p.todoId} />}
              </Route>
              <Route path="/public/:listId/t/:todoId">
                {(p) => <PublicListPage key={p.listId} listId={p.listId} todoId={p.todoId} />}
              </Route>
              <Route path="/public/:listId">
                {(p) => <PublicListPage key={p.listId} listId={p.listId} />}
              </Route>
              <Route path="/l/:listId">
                {(p) => <ListPage key={p.listId} listId={p.listId} />}
              </Route>
              <Route path="/lists/manage">
                <ManageLists />
              </Route>
              <Route path="/notes/public">
                <PublicNotesPage />
              </Route>
              <Route path="/notes">
                <NotesPage />
              </Route>
              <Route path="/tasks">
                <Home />
              </Route>
              <Route path="/settings">
                <Settings user={user} />
              </Route>
              <Route path="/admin">
                {user.role === 'admin' ? <Admin user={user} /> : <Redirect to="/" replace />}
              </Route>
              <Route>
                <Start />
              </Route>
            </Switch>
          </main>
        </div>
      </DragAndDrop>
    </ToastProvider>
  );
}
