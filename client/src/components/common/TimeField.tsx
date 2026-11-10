import { useState } from 'react';
import { TIME_PRESETS, normalizeTime } from '../../lib/timeField';
import { t } from '../../app/strings';

/**
 * The time half of the "due" row: the device's own clock control (`<input type="time">`, a
 * clock dial on phones) plus four suggested times. Rendered as a fragment so the parent grid
 * can put it next to the date; the suggestions span the full row underneath.
 * `value` is `HH:MM`, or '' for "no time". `disabled` means there is no date yet.
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
  // The value shown right now. It follows `value` (e.g. a change from another device), but
  // changes at once when the user picks something, before the saved value comes back.
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  const change = (next: string) => {
    const time = normalizeTime(next);
    setDraft(time);
    if (time !== value) onChange(time);
  };

  return (
    <>
      <label>
        {t.todo.dueTime}
        <input
          type="time"
          value={draft}
          disabled={disabled}
          onChange={(e) => change(e.target.value)}
        />
      </label>
      {!disabled && (
        <div className="time-presets" role="group" aria-label={t.todo.timePresets}>
          {TIME_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`chip${draft === p.value ? ' is-selected' : ''}`}
              aria-pressed={draft === p.value}
              onClick={() => change(p.value)}
            >
              {p.label} <span className="hint">{p.value}</span>
            </button>
          ))}
          {draft !== '' && (
            <button
              type="button"
              className="link"
              aria-label={t.todo.timeClear}
              onClick={() => change('')}
            >
              {t.todo.timeClearShort}
            </button>
          )}
        </div>
      )}
    </>
  );
}
