/**
 * When a note's text box saves, and when it shows a text that changed elsewhere
 * (docs/notes/PRD.md FR-89, FR-91, decision N6). Plain code, so it can be tested without a
 * browser; `NoteEditor` connects it to the textarea.
 *
 *  - Typing saves about a second after the last key, and at once on leaving the box.
 *  - A new stored text (sync, another user) is shown only while the user is not busy: not
 *    focused, nothing unsaved, no save running. One that arrived while busy is shown as soon
 *    as the user is not busy any more (review fix: it used to be skipped for good when it came
 *    in during a save). Typing after it arrived replaces it (latest edit wins when saved).
 *  - The echo of one of this box's own saves is not news and is never shown over newer text.
 *  - Finishing a save does not show the stored text again by itself: before the database
 *    echoes the save it is still the old text, and showing it would flash the old version.
 */
export interface NoteTextSync {
  setStored(text: string): void;
  focus(): void;
  type(text: string): void;
  blur(): void;
  /** Saves what is unsaved (page hidden, box removed). */
  flush(): void;
  dispose(): void;
}

export function createNoteTextSync(opts: {
  stored: string;
  delayMs: number;
  show: (text: string) => void;
  save: (text: string) => Promise<void> | void;
}): NoteTextSync {
  let stored = opts.stored;
  let shown = opts.stored;
  let focused = false;
  let pending: string | undefined;
  let inFlight = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** A stored text arrived while busy and has not been shown yet. */
  let missed = false;
  /**
   * Texts this box saved whose echo has not come back yet. Their echoes are not news (review
   * fix): a late echo of an earlier save would otherwise replace newer text for a moment.
   */
  const sent = new Set<string>();
  let lastSent: string | undefined;

  const busy = () => focused || pending !== undefined || inFlight > 0;

  /** Shows a stored text that arrived while busy, once the user is not busy any more. */
  function catchUp() {
    if (busy() || !missed) return;
    missed = false;
    if (shown === stored) return;
    shown = stored;
    opts.show(stored);
  }

  function flush() {
    clearTimeout(timer);
    const value = pending;
    pending = undefined;
    if (value === undefined) return;
    inFlight++;
    sent.add(value);
    lastSent = value;
    // Called right away: a box that is going away cannot wait.
    let saving: Promise<void> | void;
    try {
      saving = opts.save(value);
    } catch {
      saving = undefined;
    }
    void Promise.resolve(saving)
      .catch(() => undefined)
      .finally(() => {
        inFlight--;
        catchUp();
      });
  }

  return {
    setStored(text) {
      stored = text;
      if (sent.has(text)) {
        // Echoes arrive in order: once the last save is back, no older one can follow.
        if (text === lastSent) sent.clear();
        return;
      }
      missed = true;
      catchUp();
    },
    focus() {
      focused = true;
    },
    type(text) {
      // What the user types replaces anything received before (latest edit wins on save).
      missed = false;
      shown = text;
      pending = text;
      clearTimeout(timer);
      timer = setTimeout(flush, opts.delayMs);
    },
    blur() {
      focused = false;
      flush();
      catchUp();
    },
    flush,
    dispose() {
      flush();
    },
  };
}
