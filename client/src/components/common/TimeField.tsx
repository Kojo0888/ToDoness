import { useState } from 'react';
import { TIME_PRESETS, timeFromInput } from '../../lib/timeField';
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
  // `value` already includes a change that is still being saved (useDueEditing), so a new
  // pick is compared with what the user sees. `raw` is the input's own text: it follows
  // `value`, but also holds an unfinished keyboard edit, which is not saved.
  const [raw, setRaw] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setRaw(value);
  }
  const pick = (next: string) => {
    setRaw(next);
    if (next !== value) onChange(next);
  };

  return (
    <>
      <label>
        {t.todo.dueTime}
        <input
          type="time"
          value={raw}
          disabled={disabled}
          onChange={(e) => {
            setRaw(e.target.value);
            const time = timeFromInput(e.target.value, e.target.validity.badInput);
            if (time !== undefined && time !== value) onChange(time);
          }}
        />
      </label>
      {!disabled && (
        <div className="time-presets" role="group" aria-label={t.todo.timePresets}>
          {TIME_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`chip${value === p.value ? ' is-selected' : ''}`}
              title={p.value}
              aria-pressed={value === p.value}
              onClick={() => pick(p.value)}
            >
              {p.label} <span className="hint">{p.value}</span>
            </button>
          ))}
          {value !== '' && (
            <button
              type="button"
              className="link"
              aria-label={t.todo.timeClear}
              onClick={() => pick('')}
            >
              {t.todo.timeClearShort}
            </button>
          )}
        </div>
      )}
    </>
  );
}
