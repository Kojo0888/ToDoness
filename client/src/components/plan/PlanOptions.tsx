import { useEffect, useId, useRef, useState } from 'react';
import { NAME_MODES, type NameMode } from '../../lib/planNames';
import { t } from '../../app/strings';

/**
 * The timeline's less used settings behind a gear button (docs/plan/PRD.md FR-156): where
 * activity names are shown. A small panel below the button; Escape, the button or a click
 * outside close it.
 */
export function PlanOptions({
  nameMode,
  onNameMode,
}: {
  nameMode: NameMode;
  onNameMode: (mode: NameMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
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
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 13.5l1.6 1.2-1.8 3.1-1.9-.7a7.4 7.4 0 0 1-1.7 1l-.3 2h-3.6l-.3-2a7.4 7.4 0 0 1-1.7-1l-1.9.7-1.8-3.1 1.6-1.2a7.6 7.6 0 0 1 0-3l-1.6-1.2 1.8-3.1 1.9.7a7.4 7.4 0 0 1 1.7-1l.3-2h3.6l.3 2a7.4 7.4 0 0 1 1.7 1l1.9-.7 1.8 3.1-1.6 1.2a7.6 7.6 0 0 1 0 3Z"
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
      </div>
    </div>
  );
}
