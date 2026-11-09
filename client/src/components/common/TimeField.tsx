import { useId, useState } from 'react';
import {
  HOURS,
  TIME_PRESETS,
  composeTime,
  defaultMinute,
  minuteChoices,
  parseTime,
} from '../../lib/timeField';
import { t } from '../../app/strings';

/**
 * A time of day: an hour and a minute (the phone's own pickers), quick choices for the
 * usual times, and a way to remove it. `value` is `HH:MM`, or '' for "no time".
 */
export function TimeField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  // The value shown right now. It follows `value` (e.g. a change from another device), but
  // changes at once when the user picks something, before the saved value comes back.
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  const change = (next: string) => {
    setDraft(next);
    onChange(next);
  };
  const time = parseTime(draft);
  const hour = time?.hour ?? '';
  const minute = time?.minute ?? '';

  return (
    <div className="time-field" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="field-label">
        {t.todo.dueTime}
      </span>
      <div className="time-selects">
        <select
          aria-label={t.todo.timeHour}
          value={hour}
          disabled={disabled}
          onChange={(e) => {
            const h = e.target.value;
            change(
              composeTime(
                h,
                h === '' ? '' : minuteChoices(h).includes(minute) ? minute : defaultMinute(h),
              ),
            );
          }}
        >
          <option value="">–</option>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span aria-hidden="true">:</span>
        <select
          aria-label={t.todo.timeMinute}
          value={hour === '' ? '' : minute}
          disabled={disabled || hour === ''}
          onChange={(e) => change(composeTime(hour, e.target.value))}
        >
          {hour === '' && <option value="">–</option>}
          {hour !== '' &&
            minuteChoices(hour, minute).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
        </select>
        {draft !== '' && (
          <button
            type="button"
            className="link"
            disabled={disabled}
            aria-label={t.todo.timeClear}
            onClick={() => change('')}
          >
            {t.todo.timeClearShort}
          </button>
        )}
      </div>
      <div className="time-presets" role="group" aria-label={t.todo.timePresets}>
        {TIME_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={`chip${draft === p.value ? ' is-selected' : ''}`}
            aria-pressed={draft === p.value}
            disabled={disabled}
            onClick={() => change(p.value)}
          >
            {p.label} <span className="hint">{p.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
