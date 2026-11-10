import { useEffect, useId, useRef, useState } from 'react';
import { menuStep } from '../../lib/menuNav';
import { t } from '../../app/strings';

/**
 * One "⋯" button per list instead of a row of buttons: it opens a small menu with the
 * actions of the list. Arrow keys, Home, End, Escape and a click outside work as usual.
 */
/** Rename and Delete list. */
const ITEM_COUNT = 2;

export function ListMenu({
  name,
  onRename,
  onDelete,
}: {
  name: string;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  /** Which item gets focus when the menu opens (ArrowUp and End open on the last one). */
  const [openAt, setOpenAt] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const items = () =>
    Array.from(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  // Opening puts focus on the chosen action.
  useEffect(() => {
    if (open) items()[openAt]?.focus();
  }, [open, openAt]);

  // A click or touch outside closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) button.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const list = items();
    const current = list.indexOf(document.activeElement as HTMLElement);
    // While closed the items are not rendered yet; the menu always has these two.
    const step = menuStep(e.key, current < 0 ? null : current, open ? list.length : ITEM_COUNT);
    if (!step) return;
    if ('close' in step) {
      // Tab moves on by itself; Escape brings focus back to the button.
      if (open) close(e.key === 'Escape');
      if (e.key === 'Escape') e.preventDefault();
      return;
    }
    e.preventDefault();
    if (!open) {
      setOpenAt(step.focus);
      setOpen(true);
    } else list[step.focus]?.focus();
  }

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="row-menu" ref={wrap} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={button}
        className="row-menu-button"
        aria-label={t.manage.actions(name)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpenAt(0);
          setOpen(!open);
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            d="M5 12h.01M12 12h.01M19 12h.01"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </button>
      {open && (
        <div className="row-menu-popup" role="menu" id={menuId} aria-label={t.manage.actions(name)}>
          <button type="button" role="menuitem" onClick={choose(onRename)}>
            {t.list.rename}
          </button>
          <button type="button" role="menuitem" className="danger" onClick={choose(onDelete)}>
            {t.list.deleteList}
          </button>
        </div>
      )}
    </div>
  );
}
