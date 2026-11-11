import { useState } from 'react';
import {
  ACTIVITY_DAYS_MAX,
  ACTIVITY_NAME_MAX,
  daysBetween,
  endDay,
  isDay,
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
  onDelete,
  onClose,
}: {
  activity: Activity;
  onDelete: () => void;
  onClose: () => void;
}) {
  // `null` = nothing typed: the stored name is shown (also when it changes elsewhere).
  const [draft, setDraft] = useState<string | null>(null);
  const end = endDay(activity.start, activity.days);

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
          onChange={(e) =>
            isDay(e.target.value) &&
            void repo.updateActivity(activity.id, { start: e.target.value })
          }
        />
      </label>
      <label className="plan-field">
        {t.plan.end}
        <input
          type="date"
          value={end}
          min={activity.start}
          required
          onChange={(e) => {
            if (!isDay(e.target.value)) return;
            // An end before the start means "one day".
            const days = daysBetween(activity.start, e.target.value) + 1;
            void repo.updateActivity(activity.id, {
              days: Math.min(ACTIVITY_DAYS_MAX, Math.max(1, days)),
            });
          }}
        />
      </label>
      <span className="hint plan-duration">{t.plan.days(activity.days)}</span>
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
