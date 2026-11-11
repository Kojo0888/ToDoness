import { useId, useState } from 'react';

/**
 * The "i" info button: help text as a tooltip instead of a visible paragraph
 * (UI_GUIDELINES.md principle 4, docs/note-lists FR-123). It shows on hover, on keyboard
 * focus and on tap (phones have no hover); Escape or leaving closes it. Pass `id` to point a
 * control's `aria-describedby` at the text as well.
 */
export function InfoTip({ text, label, id }: { text: string; label: string; id?: string }) {
  const fallbackId = useId();
  const tipId = id ?? fallbackId;
  const [open, setOpen] = useState(false);
  return (
    <span className="info-tip">
      <button
        type="button"
        className="info-btn"
        aria-label={label}
        aria-describedby={tipId}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      >
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
          <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 9v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="10" cy="6.2" r="1.1" fill="currentColor" />
        </svg>
      </button>
      <span role="tooltip" id={tipId} className={`info-pop${open ? ' open' : ''}`}>
        {text}
      </span>
    </span>
  );
}
