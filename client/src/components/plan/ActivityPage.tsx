import { useLiveQuery } from 'dexie-react-hooks';
import { useState, useSyncExternalStore } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import {
  ACTIVITY_DAYS_MAX,
  ACTIVITY_NAME_MAX,
  endDay,
  isDay,
  liveLinks,
  type Activity,
} from '@todoness/shared';
import { getActivities, getPlanById } from '../../data/queries';
import { formatDay } from '../../lib/dates';
import { createPlanChanges, type PlanError } from '../../services/planChanges';
import { db, repo } from '../../app/container';
import { t } from '../../app/strings';
import { useUndoToast } from '../common/Toast';
import { planPath } from './PlansHome';

export const activityPath = (planId: string, id: string) => `${planPath(planId)}/activity/${id}`;

const ERRORS: Record<PlanError, string> = {
  loop: t.plan.loop,
  limit: t.plan.tooManyLinks,
  failed: t.plan.failed,
};

/**
 * The details of one activity (docs/plan/PRD.md FR-149 – FR-153): name, start, duration,
 * done, what it starts after, Delete. Its own page, opened from the details button on the
 * activity's row (decision P13).
 */
export function ActivityPage({ planId, activityId }: { planId: string; activityId: string }) {
  // `undefined` = loading, `null` = no such plan / activity (or it was deleted).
  const plan = useLiveQuery(async () => (await getPlanById(db, planId)) ?? null, [planId]);
  const activities = useLiveQuery(() => getActivities(db, planId), [planId]);
  const [changes] = useState(() => createPlanChanges({ db, repo, planId }));
  const { error } = useSyncExternalStore(changes.subscribe, changes.getState);
  const [, navigate] = useLocation();
  const toast = useUndoToast();

  if (plan === undefined || activities === undefined) return null;
  if (plan === null) return <Redirect to="/plans" replace />;
  const activity = activities.find((a) => a.id === activityId);
  if (!activity) return <Redirect to={planPath(planId)} replace />;

  const change = (run: () => Promise<unknown>) => void changes.run(run);

  function remove() {
    void changes
      .run(() => repo.deleteActivity(activityId))
      .then((deleted) => {
        if (!deleted) return; // refused: the page shows why
        navigate(planPath(planId));
        toast(t.plan.activityDeleted, () => void repo.restoreActivity(activityId).catch(() => {}));
      });
  }

  return (
    <section className="plan-details" aria-label={t.plan.activityDetails}>
      <header className="list-head app-bar">
        <Link
          href={planPath(planId)}
          className="icon-btn btn-back"
          aria-label={t.plan.backTo(plan.name)}
          title={t.plan.backTo(plan.name)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path
              d="M15 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <h2>{activity.name}</h2>
      </header>

      {error && (
        <p className="notice plan-message" role="alert">
          {ERRORS[error]}
        </p>
      )}

      <ActivityFields
        key={activity.id}
        activity={activity}
        activities={activities}
        change={change}
      />

      <div className="plan-details-actions">
        <button type="button" className="danger" onClick={remove}>
          {t.plan.deleteActivity}
        </button>
      </div>
    </section>
  );
}

function ActivityFields({
  activity,
  activities,
  change,
}: {
  activity: Activity;
  activities: Activity[];
  change: (run: () => Promise<unknown>) => void;
}) {
  // `null` = nothing typed: the stored value is shown (also when it changes elsewhere).
  const [name, setName] = useState<string | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const id = activity.id;
  const nameOf = (other: string) => activities.find((a) => a.id === other)?.name ?? '';
  const after = liveLinks(activities)
    .filter((l) => l.to === id)
    .map((l) => l.from);

  function saveName() {
    const next = name?.trim();
    setName(null);
    if (next && next !== activity.name) change(() => repo.updateActivity(id, { name: next }));
  }

  function saveDays() {
    const n = Number(days);
    setDays(null);
    if (days === null || !Number.isInteger(n)) return;
    const next = Math.min(ACTIVITY_DAYS_MAX, Math.max(1, n));
    if (next !== activity.days) change(() => repo.updateActivity(id, { days: next }));
  }

  return (
    <div className="plan-details-fields">
      <label className="plan-field plan-field-name">
        {t.plan.activityName}
        <input
          type="text"
          value={name ?? activity.name}
          maxLength={ACTIVITY_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveName();
            if (e.key === 'Escape') setName(null);
          }}
        />
      </label>
      <label className="plan-field">
        {t.plan.start}
        <input
          type="date"
          value={activity.start}
          required
          onChange={(e) => {
            // Read now: by the time the change runs, the field shows the saved day again.
            const start = e.target.value;
            if (isDay(start)) change(() => repo.updateActivity(id, { start }));
          }}
        />
      </label>
      {/* The duration, not the end day (FR-152); the end is a hint next to it. */}
      <label className="plan-field">
        {t.plan.duration}
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={ACTIVITY_DAYS_MAX}
          step={1}
          required
          value={days ?? String(activity.days)}
          aria-describedby={`plan-ends-${id}`}
          onChange={(e) => setDays(e.target.value)}
          onBlur={saveDays}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveDays();
            if (e.key === 'Escape') setDays(null);
          }}
        />
        <span id={`plan-ends-${id}`} className="hint plan-ends">
          {t.plan.ends(formatDay(endDay(activity.start, activity.days)))}
        </span>
      </label>
      <label className="switch plan-done">
        <input
          type="checkbox"
          role="switch"
          checked={activity.done}
          onChange={(e) => {
            const done = e.target.checked;
            change(() => repo.updateActivity(id, { done }));
          }}
        />
        {t.plan.done}
      </label>

      {/* What this activity waits for (FR-151); new links are made by dragging. */}
      {after.length > 0 && (
        <div className="plan-after">
          <h3 id={`plan-after-${id}`}>{t.plan.startsAfter}</h3>
          <ul aria-labelledby={`plan-after-${id}`}>
            {after.map((from) => (
              <li key={from}>
                <span>{nameOf(from)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t.plan.removeLink(nameOf(from))}
                  title={t.plan.removeLink(nameOf(from))}
                  onClick={() => change(() => repo.unlinkActivities(from, id))}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
