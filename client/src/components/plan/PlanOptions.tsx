import { useEffect, useId, useRef, useState } from 'react';
import { NAME_MODES, type NameMode } from '../../lib/planNames';
import { t } from '../../app/strings';

/**
 * The timeline's less used settings behind a gear button (docs/plan/PRD.md FR-156): where
 * activity names are shown, and whether done activities are hidden (FR-162). A small panel below the button; Escape, the button or a click
 * outside close it.
 */
export function PlanOptions({
  nameMode,
  onNameMode,
  hideDone,
  onHideDone,
}: {
  nameMode: NameMode;
  onNameMode: (mode: NameMode) => void;
  hideDone: boolean;
  onHideDone: (hide: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const hideId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <div className="plan-options-root" ref={root}>
      <button
        ref={button}
        type="button"
        className="icon-btn"
        aria-label={t.plan.options}
        title={t.plan.options}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {/* A symmetric gear: 8 evenly spaced teeth (generated, not hand drawn). */}
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            d="M10.55 5.25L10.69 2.79L13.31 2.79L13.45 5.25A6.9 6.9 0 0 1 15.74 6.2L17.58 4.56L19.44 6.42L17.8 8.26A6.9 6.9 0 0 1 18.75 10.55L21.21 10.69L21.21 13.31L18.75 13.45A6.9 6.9 0 0 1 17.8 15.74L19.44 17.58L17.58 19.44L15.74 17.8A6.9 6.9 0 0 1 13.45 18.75L13.31 21.21L10.69 21.21L10.55 18.75A6.9 6.9 0 0 1 8.26 17.8L6.42 19.44L4.56 17.58L6.2 15.74A6.9 6.9 0 0 1 5.25 13.45L2.79 13.31L2.79 10.69L5.25 10.55A6.9 6.9 0 0 1 6.2 8.26L4.56 6.42L6.42 4.56L8.26 6.2A6.9 6.9 0 0 1 10.55 5.25Z M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div id={panelId} className="plan-options" hidden={!open}>
        <span className="plan-options-label" aria-hidden="true">
          {t.plan.names}
        </span>
        <div className="chip-group" role="group" aria-label={t.plan.names}>
          {NAME_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`chip${mode === nameMode ? ' is-selected' : ''}`}
              aria-pressed={mode === nameMode}
              onClick={() => onNameMode(mode)}
            >
              {t.plan.nameModes[mode]}
            </button>
          ))}
        </div>
        <div className="plan-options-switch">
          <label htmlFor={hideId}>{t.plan.hideDone}</label>
          <span className="switch">
            <input
              id={hideId}
              type="checkbox"
              role="switch"
              checked={hideDone}
              onChange={(e) => onHideDone(e.target.checked)}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
