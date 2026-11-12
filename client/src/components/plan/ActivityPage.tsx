import { useLiveQuery } from 'dexie-react-hooks';
import { useState, useSyncExternalStore } from 'react';
import { Redirect, useLocation } from 'wouter';
import {
  ACTIVITY_DAYS_MAX,
  ACTIVITY_NAME_MAX,
  GROUP_DEPTH_MAX,
  depthOf,
  endDay,
  heightOf,
  isDay,
  isGroup,
  isInside,
  leavesOf,
  liveLinks,
  planTree,
  spansOf,
  type Activity,
  type PlanTree,
} from '@todoness/shared';
import { getActivities, getPlanById } from '../../data/queries';
import { formatDay } from '../../lib/dates';
import { browserStorage } from '../../lib/modules';
import { readAutoSort } from '../../lib/planAutoSort';
import { createPlanChanges, type PlanError } from '../../services/planChanges';
import { db, repo } from '../../app/container';
import { t } from '../../app/strings';
import { useUndoToast } from '../common/Toast';
import { AppBar } from '../common/icons';
import { InfoTip } from '../common/InfoTip';
import { planPath } from './PlansHome';

export const activityPath = (planId: string, id: string) => `${planPath(planId)}/activity/${id}`;

const ERRORS: Record<PlanError, string> = {
  loop: t.plan.loop,
  limit: t.plan.tooManyLinks,
  depth: t.plan.tooDeep,
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
  const [changes] = useState(() =>
    createPlanChanges({ db, repo, planId, autoSort: () => readAutoSort(browserStorage()) }),
  );
  const { error } = useSyncExternalStore(changes.subscribe, changes.getState);
  const [, navigate] = useLocation();
  const toast = useUndoToast();

  if (plan === undefined || activities === undefined) return null;
  if (plan === null) return <Redirect to="/plans" replace />;
  const activity = activities.find((a) => a.id === activityId);
  if (!activity) return <Redirect to={planPath(planId)} replace />;

  const change = (run: () => Promise<unknown>) => void changes.run(run);
  const tree = planTree(activities);
  const grouped = isGroup(tree, activityId);
  // Everything inside a group (FR-186).
  const inside = activities.filter((a) => a.id !== activityId && isInside(tree, a.id, activityId));

  function remove() {
    void changes
      .run(() => repo.deleteActivity(activityId))
      .then((deleted) => {
        if (!deleted) return; // refused: the page shows why
        navigate(planPath(planId));
        toast(
          grouped ? t.plan.groupDeleted : t.plan.activityDeleted,
          () => void repo.restoreActivity(activityId).catch(() => {}),
        );
      });
  }

  function ungroup() {
    void changes
      .run(() => repo.ungroupActivity(activityId))
      .then((children) => {
        if (!children) return; // refused: the page shows why
        navigate(planPath(planId));
        toast(
          t.plan.ungrouped,
          () => void repo.regroupActivity(activityId, children).catch(() => {}),
        );
      });
  }

  return (
    <section className="plan-details" aria-label={t.plan.activityDetails}>
      <AppBar
        backHref={planPath(planId)}
        backLabel={t.plan.backTo(plan.name)}
        title={activity.name}
      />

      {error && (
        <p className="notice plan-message" role="alert">
          {ERRORS[error]}
        </p>
      )}

      <ActivityFields
        key={activity.id}
        activity={activity}
        activities={activities}
        tree={tree}
        change={change}
      />

      <div className="plan-details-actions">
        {grouped && (
          <button type="button" onClick={ungroup}>
            {t.plan.ungroup}
          </button>
        )}
        <button type="button" className="danger" onClick={remove}>
          {grouped ? t.plan.deleteGroup(inside.length) : t.plan.deleteActivity}
        </button>
      </div>
    </section>
  );
}

function ActivityFields({
  activity,
  activities,
  tree,
  change,
}: {
  activity: Activity;
  activities: Activity[];
  tree: PlanTree;
  change: (run: () => Promise<unknown>) => void;
}) {
  // `null` = nothing typed: the stored value is shown (also when it changes elsewhere).
  const [name, setName] = useState<string | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const id = activity.id;
  // A group's dates and done come from its activities (FR-175, FR-184).
  const grouped = isGroup(tree, id);
  const span = spansOf(activities, tree).get(id)!;
  const done = leavesOf(tree, id).every((l) => activities.find((a) => a.id === l)?.done);
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
          value={span.start}
          required
          onChange={(e) => {
            // Read now: by the time the change runs, the field shows the saved day again.
            const start = e.target.value;
            if (isDay(start)) change(() => repo.updateActivity(id, { start }));
          }}
        />
      </label>
      {grouped ? (
        <div className="plan-field plan-group-dates">
          <span className="plan-field-label">
            {t.plan.groupDates}
            <InfoTip text={t.plan.groupDatesHelp} label={t.plan.groupDates} />
          </span>
          <span className="plan-group-span">
            {t.plan.groupSpan(span.days, formatDay(endDay(span.start, span.days)))}
          </span>
        </div>
      ) : (
        <>
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
        </>
      )}
      <PartOf activity={activity} activities={activities} tree={tree} change={change} />
      <label className="switch plan-done">
        <input
          type="checkbox"
          role="switch"
          checked={done}
          // A group is done when all its activities are; it is never set by itself (FR-184).
          disabled={isGroup(tree, id)}
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

/**
 * Part of (FR-177): none, a group to join, or a new group with another activity. Only what
 * the rules allow is offered: not the activity itself or anything inside it, nothing deeper
 * than GROUP_DEPTH_MAX.
 */
function PartOf({
  activity,
  activities,
  tree,
  change,
}: {
  activity: Activity;
  activities: Activity[];
  tree: PlanTree;
  change: (run: () => Promise<unknown>) => void;
}) {
  const id = activity.id;
  const height = heightOf(tree, id);
  const allowed = activities.filter(
    (a) =>
      a.id !== id && !isInside(tree, a.id, id) && depthOf(tree, a.id) + height <= GROUP_DEPTH_MAX,
  );
  const groups = allowed.filter((a) => isGroup(tree, a.id));
  const others = allowed.filter((a) => !isGroup(tree, a.id));
  const parent = tree.parent.get(id);
  return (
    <label className="plan-field plan-part-of">
      {t.plan.partOf}
      <select
        value={parent === undefined ? '' : `group:${parent}`}
        onChange={(e) => {
          const [kind, target] = e.target.value.split(':') as [string, string | undefined];
          if (kind === '') change(() => repo.moveToGroup(id, null));
          else if (kind === 'group') change(() => repo.moveToGroup(id, target!));
          else change(() => repo.groupActivities(target!, id));
        }}
      >
        <option value="">{t.plan.partOfNone}</option>
        {groups.length > 0 && (
          <optgroup label={t.plan.partOfGroups}>
            {groups.map((g) => (
              <option key={g.id} value={`group:${g.id}`}>
                {g.name}
              </option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label={t.plan.partOfNew}>
            {others.map((a) => (
              <option key={a.id} value={`with:${a.id}`}>
                {t.plan.newGroupWith(a.name)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}
