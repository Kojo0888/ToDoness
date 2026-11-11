import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useState, type FormEvent } from 'react';
import { Redirect } from 'wouter';
import { ACTIVITY_NAME_MAX, PLAN_NAME_MAX } from '@todoness/shared';
import { getActivities, getPlanById } from '../../data/queries';
import { browserStorage } from '../../lib/modules';
import { NAME_MODES, readNameMode, saveNameMode, type NameMode } from '../../lib/planNames';
import { db, repo } from '../../app/container';
import { t } from '../../app/strings';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useUndoToast } from '../common/Toast';
import { ActivityBar } from './ActivityBar';
import { Timeline } from './Timeline';

/** One plan: its name, a field for new activities and the timeline (docs/plan/PRD.md). */
export function PlanPage({ planId }: { planId: string }) {
  // `undefined` = loading, `null` = no such plan (or it was deleted).
  const plan = useLiveQuery(async () => (await getPlanById(db, planId)) ?? null, [planId]);
  const activities = useLiveQuery(() => getActivities(db, planId), [planId], []);
  const toast = useUndoToast();

  const [nameMode, setNameMode] = useState<NameMode>(() => readNameMode(browserStorage()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newName, setNewName] = useState('');

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

  async function rename(e: FormEvent) {
    e.preventDefault();
    const next = renaming?.trim();
    setRenaming(null);
    if (next) await repo.renamePlan(planId, next);
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
        {renaming === null ? (
          <h2>{plan.name}</h2>
        ) : (
          <form onSubmit={rename} className="rename">
            <input
              type="text"
              aria-label={t.plan.nameLabel}
              value={renaming}
              maxLength={PLAN_NAME_MAX}
              autoFocus
              onChange={(e) => setRenaming(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
            />
            <button type="submit" className="primary">
              {t.plan.save}
            </button>
            <button type="button" onClick={() => setRenaming(null)}>
              {t.plan.cancel}
            </button>
          </form>
        )}
        {renaming === null && (
          <div className="list-actions">
            <button type="button" onClick={() => setRenaming(plan.name)}>
              {t.plan.rename}
            </button>
            <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>
              {t.plan.deletePlan}
            </button>
          </div>
        )}
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

      {message && (
        <p className="notice plan-message" role="alert">
          {message}
        </p>
      )}

      {selected && (
        <ActivityBar
          key={selected.id}
          activity={selected}
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
        onMessage={setMessage}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={t.plan.deletePlanTitle}
        confirmLabel={t.plan.deletePlan}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void repo.deletePlan(planId);
        }}
      >
        <p>{t.plan.deletePlanText(plan.name, activities.length)}</p>
      </ConfirmDialog>
    </section>
  );
}
