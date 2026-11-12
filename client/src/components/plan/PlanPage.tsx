import { useLiveQuery } from 'dexie-react-hooks';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { Redirect } from 'wouter';
import { ACTIVITY_NAME_MAX, isGroup, planTree } from '@todoness/shared';
import { getActivities, getPlanById } from '../../data/queries';
import { browserStorage } from '../../lib/modules';
import { readNameMode, saveNameMode, type NameMode } from '../../lib/planNames';
import { readHideDone, saveHideDone } from '../../lib/planHideDone';
import { readCollapsed, saveCollapsed } from '../../lib/planCollapsed';
import { readScale, saveScale } from '../../lib/planScale';
import { SCALES, type Scale } from '../../lib/timeline';
import { createPlanChanges, type PlanError } from '../../services/planChanges';
import { db, repo } from '../../app/container';
import { t } from '../../app/strings';
import { useUndoToast } from '../common/Toast';
import { PlanOptions } from './PlanOptions';
import { Timeline } from './Timeline';

const ERRORS: Record<PlanError, string> = {
  loop: t.plan.loop,
  limit: t.plan.tooManyLinks,
  depth: t.plan.tooDeep,
  failed: t.plan.failed,
};

/**
 * One plan: its name, a field for new activities, the scale and the options, the timeline
 * and Undo last change below it (docs/plan/PRD.md). Plans are renamed and deleted on the
 * Manage plans page, as lists are; an activity's details have their own page.
 */
export function PlanPage({ planId }: { planId: string }) {
  // `undefined` = loading, `null` = no such plan (or it was deleted).
  const plan = useLiveQuery(async () => (await getPlanById(db, planId)) ?? null, [planId]);
  const activities = useLiveQuery(() => getActivities(db, planId), [planId], []);
  const toast = useUndoToast();

  const [nameMode, setNameMode] = useState<NameMode>(() => readNameMode(browserStorage()));
  const [scale, setScale] = useState<Scale>(() => readScale(browserStorage()));
  const [hideDone, setHideDone] = useState(() => readHideDone(browserStorage()));
  // Collapsed groups of this plan, remembered on this device (FR-181).
  const [collapsed, setCollapsed] = useState(() => readCollapsed(browserStorage(), planId));
  const tree = useMemo(() => planTree(activities), [activities]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  // Every change of this page goes through here: one at a time, undoable where it alters
  // dates or links, and failures are shown (services/planChanges.ts, FR-147).
  const [changes] = useState(() => createPlanChanges({ db, repo, planId }));
  const { undo, error } = useSyncExternalStore(changes.subscribe, changes.getState);
  const message = error ? ERRORS[error] : null;

  // Ctrl / ⌘ + Z, except while typing in a field (there it undoes the typing).
  const canUndo = undo !== null;
  useEffect(() => {
    if (!canUndo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        return;
      }
      e.preventDefault();
      void changes.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canUndo, changes]);

  const toggleGroup = useCallback(
    (id: string) => {
      setCollapsed((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        saveCollapsed(browserStorage(), planId, next);
        return next;
      });
    },
    [planId],
  );

  const deleteActivity = useCallback(
    (id: string) => {
      setSelectedId((current) => (current === id ? null : current));
      // A group goes with everything in it (FR-186).
      const message = isGroup(tree, id) ? t.plan.groupDeleted : t.plan.activityDeleted;
      void changes
        .run(() => repo.deleteActivity(id))
        .then((deleted) => {
          if (!deleted) return; // refused: the page shows why
          toast(message, () => void changes.run(() => repo.restoreActivity(id)));
        });
    },
    [changes, toast, tree],
  );

  if (plan === undefined) return null;
  if (plan === null) return <Redirect to="/plans" replace />;

  const selected = activities.find((a) => a.id === selectedId);

  function chooseNames(mode: NameMode) {
    saveNameMode(browserStorage(), mode);
    setNameMode(mode);
  }

  function chooseHideDone(hide: boolean) {
    saveHideDone(browserStorage(), hide);
    setHideDone(hide);
  }

  function chooseScale(next: Scale) {
    saveScale(browserStorage(), next);
    setScale(next);
  }

  async function addActivity(e: FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    setNewName('');
    await changes.run(() => repo.createActivity(planId, trimmed));
  }

  return (
    <section className="plan-page" aria-label={plan.name}>
      <header className="list-head">
        <h2>{plan.name}</h2>
      </header>

      <div className="plan-tools">
        <form onSubmit={addActivity} className="plan-add">
          <input
            type="text"
            aria-label={t.plan.addActivity}
            placeholder={t.plan.addActivityPlaceholder}
            value={newName}
            maxLength={ACTIVITY_NAME_MAX}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" className="primary">
            {t.plan.addActivityButton}
          </button>
        </form>
        <div className="plan-view">
          <div className="chip-group" role="group" aria-label={t.plan.scale}>
            {SCALES.map((option) => (
              <button
                key={option}
                type="button"
                className={`chip${option === scale ? ' is-selected' : ''}`}
                aria-pressed={option === scale}
                onClick={() => chooseScale(option)}
              >
                {t.plan.scales[option]}
              </button>
            ))}
          </div>
          <PlanOptions
            nameMode={nameMode}
            onNameMode={chooseNames}
            hideDone={hideDone}
            onHideDone={chooseHideDone}
          />
        </div>
      </div>

      {message && (
        <p className="notice plan-message" role="alert">
          {message}
        </p>
      )}

      {activities.length === 0 && <p className="empty">{t.plan.noActivities}</p>}
      {hideDone &&
        activities.length > 0 &&
        activities.every((a) => a.done || isGroup(tree, a.id)) && (
          <p className="empty">{t.plan.allDoneHidden}</p>
        )}

      <Timeline
        activities={activities}
        nameMode={nameMode}
        scale={scale}
        hideDone={hideDone}
        collapsed={collapsed}
        onToggleGroup={toggleGroup}
        planId={planId}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
        onDelete={deleteActivity}
        change={changes.run}
      />

      {/* At the bottom of the plan (FR-158); Ctrl / ⌘ + Z works anywhere on the page. */}
      <div className="plan-foot">
        <button
          type="button"
          className="plan-undo"
          disabled={!canUndo}
          onClick={() => void changes.undo()}
        >
          <span aria-hidden="true" className="btn-icon">
            ↶
          </span>
          {t.plan.undo}
        </button>
      </div>
    </section>
  );
}
