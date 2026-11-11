import { useState } from 'react';
import {
  ACTIVITY_DAYS_MAX,
  ACTIVITY_NAME_MAX,
  daysBetween,
  endDay,
  isDay,
  wouldLoop,
  type Activity,
} from '@todoness/shared';
import { repo } from '../../app/container';
import { t } from '../../app/strings';

/**
 * The three properties of the selected activity, and Delete (docs/plan/PRD.md FR-130).
 * Not a details view (decision P5): it is the place to rename an activity and the exact,
 * keyboard and phone friendly way to set its days. Dates use the device's own picker.
 */
export function ActivityBar({
  activity,
  others,
  change,
  onDelete,
  onClose,
}: {
  activity: Activity;
  /** All activities of the plan (to choose what this one starts after). */
  others: Activity[];
  /** Runs a change so that "Undo last change" can take it back. */
  change: (run: () => Promise<unknown>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // `null` = nothing typed: the stored name is shown (also when it changes elsewhere).
  const [draft, setDraft] = useState<string | null>(null);
  const end = endDay(activity.start, activity.days);
  // What can still come before this one: not linked yet, and not closing a loop.
  const candidates = others.filter(
    (o) =>
      o.id !== activity.id &&
      !activity.dependsOn.includes(o.id) &&
      !wouldLoop(others, o.id, activity.id),
  );

  function saveName() {
    const next = draft?.trim();
    setDraft(null);
    if (next && next !== activity.name) void repo.updateActivity(activity.id, { name: next });
  }

  return (
    <div className="plan-activity-bar" role="group" aria-label={t.plan.selected}>
      <label className="plan-field plan-field-name">
        {t.plan.activityName}
        <input
          type="text"
          value={draft ?? activity.name}
          maxLength={ACTIVITY_NAME_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveName();
            if (e.key === 'Escape') setDraft(null);
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
            if (isDay(start)) change(() => repo.updateActivity(activity.id, { start }));
          }}
        />
      </label>
      <label className="plan-field">
        {t.plan.end} <span className="hint">({t.plan.days(activity.days)})</span>
        <input
          type="date"
          value={end}
          min={activity.start}
          required
          onChange={(e) => {
            if (!isDay(e.target.value)) return;
            // An end before the start means "one day".
            const days = daysBetween(activity.start, e.target.value) + 1;
            change(() =>
              repo.updateActivity(activity.id, {
                days: Math.min(ACTIVITY_DAYS_MAX, Math.max(1, days)),
              }),
            );
          }}
        />
      </label>
      {/* Linking without dragging (FR-133): the chosen activity must end before this one. */}
      <label className="plan-field">
        {t.plan.startsAfter}
        <select
          value=""
          disabled={candidates.length === 0}
          onChange={(e) => {
            const from = e.target.value;
            if (from) change(() => repo.linkActivities(from, activity.id));
          }}
        >
          <option value="">{t.plan.startsAfterAdd}</option>
          {candidates.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <div className="plan-bar-actions">
        <button type="button" className="danger" onClick={onDelete}>
          {t.plan.deleteActivity}
        </button>
        <button type="button" onClick={onClose}>
          {t.plan.done}
        </button>
      </div>
    </div>
  );
}
