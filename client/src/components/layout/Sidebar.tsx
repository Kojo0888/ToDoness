import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Link, useLocation } from 'wouter';
import { listDropId } from '../../lib/dnd';
import { LIST_NAME_MAX, PLAN_NAME_MAX } from '@todoness/shared';
import { MANAGE_LISTS_PATH, MANAGE_NOTE_LISTS_PATH, noteListPath } from '../../lib/listManage';
import {
  countActivitiesByPlan,
  countNotesByList,
  countOpenTodosByList,
  getLists,
  getNoteLists,
  getPlans,
} from '../../data/queries';
import { useModule } from '../../app/hooks';
import { usePublicLists, usePublicNotes } from '../../app/publicHooks';
import { db, repo } from '../../app/container';
import type { StoredUser } from '../../services/session';
import { t } from '../../app/strings';
import { MANAGE_PLANS_PATH } from '../plan/ManagePlans';
import { planPath } from '../plan/PlansHome';
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
        ) : current === 'plan' ? (
          <PlanNav active={active} onNavigate={onNavigate} />
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
  const lists = useLiveQuery(() => getLists(db), [], []);
  const counts = useLiveQuery(() => countOpenTodosByList(db), [], new Map<string, number>());
  const { lists: publicLists, failed: publicFailed } = usePublicLists();

  return (
    <>
      <ul className="nav-lists" aria-label={t.nav.lists}>
        {lists.map((l) => (
          <ListLink
            key={l.id}
            id={l.id}
            name={l.name}
            count={counts.get(l.id) ?? 0}
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

      <ManageLink
        href={MANAGE_LISTS_PATH}
        label={t.nav.manageLists}
        active={active(MANAGE_LISTS_PATH)}
        onNavigate={onNavigate}
      />

      <NewItemForm
        label={t.nav.newList}
        addLabel={t.nav.addList}
        maxLength={LIST_NAME_MAX}
        create={async (name) => `/l/${(await repo.createList(name)).id}`}
        onNavigate={onNavigate}
      />
    </>
  );
}

/** The Notes module: the note lists (My notes first) and other users' public notes, with
 *  counts; manage and add note lists (docs/note-lists FR-125, FR-126). */
function NotesNav({ location, onNavigate }: { location: string; onNavigate: () => void }) {
  const lists = useLiveQuery(() => getNoteLists(db), [], []);
  const counts = useLiveQuery(() => countNotesByList(db), [], new Map<string | null, number>());
  // The public notes page refreshes them itself; here only the copy is read then.
  const shared = usePublicNotes({ refresh: location !== '/notes/public' });

  const myNotes = lists.find((l) => l.isInbox);
  const others = lists.filter((l) => !l.isInbox);
  const isActive = (href: string) => location === href || location === `${href}/`;

  const link = (
    key: string,
    href: string,
    label: string,
    count: number | undefined,
    tooltip?: string,
  ) => (
    <li key={key}>
      <Link
        href={href}
        className={isActive(href) ? 'active' : ''}
        aria-current={isActive(href) ? 'page' : undefined}
        onClick={onNavigate}
        title={tooltip}
      >
        <span className="nav-name">{label}</span>
        {count !== undefined && (
          <span className="nav-count" title={t.common.notesCount(count)}>
            {count}
          </span>
        )}
        {tooltip && (
          <span className="nav-info" aria-hidden="true">
            ⓘ
          </span>
        )}
      </Link>
    </li>
  );

  return (
    <>
      <ul className="nav-lists" aria-label={t.modules.notes}>
        {link('mine', '/notes', myNotes?.name ?? t.notes.myNotes, counts.get(null) ?? 0)}
        {others.map((l) => link(l.id, noteListPath(l.id), l.name, counts.get(l.id) ?? 0))}
        {link(
          'public',
          '/notes/public',
          t.notes.publicNotes,
          shared.value?.length,
          // Not on this device yet: said in a tooltip rather than a line in the sidebar.
          shared.value === null && shared.failed ? t.notes.publicNeedsConnection : undefined,
        )}
      </ul>

      <ManageLink
        href={MANAGE_NOTE_LISTS_PATH}
        label={t.notes.manageLists}
        active={isActive(MANAGE_NOTE_LISTS_PATH)}
        onNavigate={onNavigate}
      />

      <NewItemForm
        label={t.notes.newList}
        addLabel={t.notes.addList}
        maxLength={LIST_NAME_MAX}
        create={async (name) => noteListPath((await repo.createList(name, 'notes')).id)}
        onNavigate={onNavigate}
      />
    </>
  );
}

/** The Plan module: the user's plans and a new plan, like lists (docs/plan/PRD.md FR-120). */
function PlanNav({
  active,
  onNavigate,
}: {
  active: (href: string) => boolean;
  onNavigate: () => void;
}) {
  const plans = useLiveQuery(() => getPlans(db), [], []);
  const counts = useLiveQuery(() => countActivitiesByPlan(db), [], new Map<string, number>());

  return (
    <>
      <ul className="nav-lists" aria-label={t.plan.plans}>
        {plans.map((p) => {
          const href = planPath(p.id);
          const count = counts.get(p.id) ?? 0;
          return (
            <li key={p.id}>
              <Link
                href={href}
                className={active(href) ? 'active' : ''}
                aria-current={active(href) ? 'page' : undefined}
                onClick={onNavigate}
              >
                <span className="nav-name">{p.name}</span>
                {/* All activities, done ones included (FR-160, decision P17). */}
                <span className="nav-count" title={t.common.activitiesCount(count)}>
                  {count}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <ManageLink
        href={MANAGE_PLANS_PATH}
        label={t.plan.managePlans}
        active={active(MANAGE_PLANS_PATH)}
        onNavigate={onNavigate}
      />

      <NewItemForm
        label={t.plan.newPlan}
        addLabel={t.plan.addPlan}
        maxLength={PLAN_NAME_MAX}
        create={async (name) => planPath((await repo.createPlan(name)).id)}
        onNavigate={onNavigate}
      />
    </>
  );
}

/** A sidebar list: a link, and a place where a dragged task can be dropped (FR-39). */
function ListLink({
  id,
  name,
  count,
  active,
  onNavigate,
}: {
  id: string;
  name: string;
  /** Open tasks (FR-132), shown like the note counts. */
  count: number;
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
        <span className="nav-name">{name}</span>
        <span className="nav-count" title={t.common.openTasks(count)}>
          {count}
        </span>
      </Link>
    </li>
  );
}

/** "Manage lists / note lists / plans": a full-width button-like link (UI_GUIDELINES.md). */
function ManageLink({
  href,
  label,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`btn btn-block manage-lists-link${active ? ' active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <span aria-hidden="true" className="btn-icon">
        ☰
      </span>
      {label}
    </Link>
  );
}

/** A name field and an Add button at the bottom of the sidebar; opens what it created. */
function NewItemForm({
  label,
  addLabel,
  maxLength,
  create,
  onNavigate,
}: {
  label: string;
  addLabel: string;
  maxLength: number;
  /** Creates the item and returns the path of its page. */
  create: (name: string) => Promise<string>;
  onNavigate: () => void;
}) {
  const [, navigate] = useLocation();
  const [name, setName] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setName('');
    navigate(await create(trimmed));
    onNavigate();
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="new-list">
      <input
        type="text"
        aria-label={label}
        placeholder={label}
        value={name}
        maxLength={maxLength}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit">{addLabel}</button>
    </form>
  );
}
