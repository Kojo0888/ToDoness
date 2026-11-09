import { useEffect, useRef, useState } from 'react';
import { NOTE_TEXT_MAX } from '@todoness/shared';
import { createNoteTextSync, type NoteTextSync } from './noteTextSync';

export const SAVE_DELAY_MS = 1000;

interface Props {
  /** The text as stored (local database, or the kept copy of public notes). */
  stored: string;
  label: string;
  disabled?: boolean;
  /** Saves the text; called about a second after typing stops, and on leaving the box. */
  onSave: (text: string) => Promise<void> | void;
}

/** A note's text box that saves itself; the rules are in `noteTextSync.ts`. */
export function NoteEditor({ stored, label, disabled, onSave }: Props) {
  const [text, setText] = useState(stored);
  const save = useRef(onSave);
  const sync = useRef<NoteTextSync | null>(null);
  useEffect(() => {
    save.current = onSave;
  });

  useEffect(() => {
    const s = createNoteTextSync({
      stored,
      delayMs: SAVE_DELAY_MS,
      show: setText,
      save: (value) => save.current(value),
    });
    sync.current = s;
    // Never lose typed text: save when the page is hidden or the box goes away.
    const onHide = () => s.flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      s.dispose();
    };
    // Created once per box; later stored texts arrive through `setStored` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sync.current?.setStored(stored);
  }, [stored]);

  return (
    <textarea
      className="note-text"
      aria-label={label}
      value={text}
      rows={4}
      maxLength={NOTE_TEXT_MAX}
      disabled={disabled}
      onFocus={() => sync.current?.focus()}
      onChange={(e) => {
        setText(e.target.value);
        sync.current?.type(e.target.value);
      }}
      onBlur={() => sync.current?.blur()}
    />
  );
}
