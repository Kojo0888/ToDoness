import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Redirect } from 'wouter';
import { ACTIVITY_NAME_MAX } from '@todoness/shared';
import { getActivities, getPlanById } from '../../data/queries';
import { RepoError, type ActivityState } from '../../data/repo';
import { browserStorage } from '../../lib/modules';
import { NAME_MODES, readNameMode, saveNameMode, type NameMode } from '../../lib/planNames';
import { db, repo } from '../../app/container';
import { t } from '../../app/strings';
import { useUndoToast } from '../common/Toast';
import { ActivityBar } from './ActivityBar';
import { Timeline } from './Timeline';

const stateOf = ({ id, start, days, dependsOn }: ActivityState): ActivityState => ({
  id,
  start,
  days,
  dependsOn,
});
const sameState = (a: ActivityState[], b: ActivityState[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * One plan: its name, a field for new activities and the timeline (docs/plan/PRD.md).
 * Plans are renamed and deleted on the Manage plans page, as lists are.
 */
export function PlanPage({ planId }: { planId: string }) {
  // `undefined` = loading, `null` = no such plan (or it was deleted).
  const plan = useLiveQuery(async () => (await getPlanById(db, planId)) ?? null, [planId]);
  const activities = useLiveQuery(() => getActivities(db, planId), [planId], []);
  const toast = useUndoToast();

  const [nameMode, setNameMode] = useState<NameMode>(() => readNameMode(browserStorage()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  /** The plan's activities as they were before the last change on the timeline (FR-147). */
  const [undo, setUndo] = useState<ActivityState[] | null>(null);

  /**
   * Runs a change of dates or links and remembers what the plan looked like before it, so
   * "Undo last change" can put exactly that back, including what the change pushed.
   */
  const change = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T | undefined> => {
      const read = async () => (await getActivities(db, planId)).map(stateOf);
      const before = await read();
      setMessage(null);
      try {
        const result = await run();
        if (!sameState(before, await read())) setUndo(before);
        return result;
      } catch (err) {
        setMessage(err instanceof RepoError && err.code === 'loop' ? t.plan.loop : t.plan.failed);
        return undefined;
      }
    },
    [planId],
  );

  const undoLast = useCallback(() => {
    if (!undo) return;
    setUndo(null);
    setMessage(null);
    void repo.revertActivities(undo);
  }, [undo]);

  // Ctrl / ⌘ + Z, except while typing in a field (there it undoes the typing).
  useEffect(() => {
    if (!undo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        return;
      }
      e.preventDefault();
      undoLast();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, undoLast]);

  const deleteActivity = useCallback(
    (id: string) => {
      setSelectedId((current) => (current === id ? null : current));
      void repo.deleteActivity(id).then(() => {
        toast(t.plan.activityDeleted, () => void repo.restoreActivity(id));
      });
    },
    [toast],
  );

  if (plan === undefined) return null;
  if (plan === null) return <Redirect to="/plans" replace />;

  const selected = activities.find((a) => a.id === selectedId);

  function chooseNames(mode: NameMode) {
    saveNameMode(browserStorage(), mode);
    setNameMode(mode);
  }

  async function addActivity(e: FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    setNewName('');
    setMessage(null);
    await repo.createActivity(planId, trimmed);
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
          <button type="button" className="plan-undo" disabled={!undo} onClick={undoLast}>
            <span aria-hidden="true" className="btn-icon">
              ↶
            </span>
            {t.plan.undo}
          </button>
          <div className="chip-group" role="group" aria-label={t.plan.names}>
            {NAME_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={`chip${mode === nameMode ? ' is-selected' : ''}`}
                aria-pressed={mode === nameMode}
                onClick={() => chooseNames(mode)}
              >
                {t.plan.nameModes[mode]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {message && (
        <p className="notice plan-message" role="alert">
          {message}
        </p>
      )}

      {selected && (
        <ActivityBar
          key={selected.id}
          activity={selected}
          others={activities}
          change={(run) => void change(run)}
          onDelete={() => deleteActivity(selected.id)}
          onClose={() => setSelectedId(null)}
        />
      )}

      {activities.length === 0 && <p className="empty">{t.plan.noActivities}</p>}

      <Timeline
        activities={activities}
        nameMode={nameMode}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
        onDelete={deleteActivity}
        change={change}
      />
    </section>
  );
}
