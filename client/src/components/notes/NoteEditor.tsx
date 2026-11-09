import { useEffect, useRef, useState } from 'react';
import { NOTE_TEXT_MAX } from '@todoness/shared';

export const SAVE_DELAY_MS = 1000;

interface Props {
  /** The text as stored (local database or server). */
  stored: string;
  label: string;
  disabled?: boolean;
  /** Saves the text; called about a second after typing stops, and on leaving the box. */
  onSave: (text: string) => Promise<void> | void;
}

/**
 * A note's text box that saves itself (docs/notes/PRD.md FR-89, FR-91, decision N6).
 * While the user is typing (focused, or not saved yet) a new `stored` value does not
 * replace the text under the cursor; once the box is left and saved, it follows `stored`.
 */
export function NoteEditor({ stored, label, disabled, onSave }: Props) {
  const [text, setText] = useState(stored);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Text typed but not saved yet. */
  const pending = useRef<string | undefined>(undefined);
  const focused = useRef(false);
  const inFlight = useRef(0);
  const storedRef = useRef(stored);
  const save = useRef(onSave);
  useEffect(() => {
    storedRef.current = stored;
    save.current = onSave;
  });

  /** Shows the stored text, unless the user is busy with this box. */
  const follow = useRef(() => {
    if (!focused.current && pending.current === undefined && inFlight.current === 0) {
      setText(storedRef.current);
    }
  });

  const flush = useRef(() => {
    clearTimeout(timer.current);
    const value = pending.current;
    pending.current = undefined;
    if (value === undefined) return;
    inFlight.current++;
    // The new stored value arrives by itself (live query, refresh); nothing to do after.
    void Promise.resolve(save.current(value))
      .catch(() => undefined)
      .finally(() => inFlight.current--);
  });

  // Follow changes from elsewhere (sync, another user).
  useEffect(() => {
    storedRef.current = stored;
    follow.current();
  }, [stored]);

  // Never lose typed text: save when the page is hidden or the box goes away.
  useEffect(() => {
    const save = flush.current;
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
  }, []);

  return (
    <textarea
      className="note-text"
      aria-label={label}
      value={text}
      rows={4}
      maxLength={NOTE_TEXT_MAX}
      disabled={disabled}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        setText(e.target.value);
        pending.current = e.target.value;
        clearTimeout(timer.current);
        timer.current = setTimeout(flush.current, SAVE_DELAY_MS);
      }}
      onBlur={() => {
        focused.current = false;
        flush.current();
        follow.current();
      }}
    />
  );
}
