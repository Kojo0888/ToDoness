/** The save / follow logic of a note's text box (docs/notes/PRD.md FR-89, FR-91). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNoteTextSync } from '../../src/components/notes/noteTextSync';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(stored = 'one') {
  const shown: string[] = [];
  const saves: { text: string; done: () => void }[] = [];
  const sync = createNoteTextSync({
    stored,
    delayMs: 1000,
    show: (t) => shown.push(t),
    save: (text) =>
      new Promise<void>((resolve) => {
        saves.push({ text, done: resolve });
      }),
  });
  return { sync, shown, saves };
}

describe('noteTextSync', () => {
  it('saves a second after typing stops, and at once on leaving the box', () => {
    const { sync, saves } = setup();
    sync.focus();
    sync.type('o');
    sync.type('on');
    vi.advanceTimersByTime(999);
    expect(saves).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(saves.map((s) => s.text)).toEqual(['on']);
    sync.type('one!');
    sync.blur();
    expect(saves.map((s) => s.text)).toEqual(['on', 'one!']);
  });

  it('follows a new stored text when the user is not busy', () => {
    const { sync, shown } = setup();
    sync.setStored('from elsewhere');
    expect(shown).toEqual(['from elsewhere']);
  });

  it('does not replace the text while focused; takes it on leaving if nothing was typed', () => {
    const { sync, shown } = setup();
    sync.focus();
    sync.setStored('from elsewhere');
    expect(shown).toEqual([]);
    sync.blur();
    expect(shown).toEqual(['from elsewhere']);
  });

  it('a change that arrives during a save is shown once the save is done', async () => {
    const { sync, shown, saves } = setup();
    sync.focus();
    sync.type('mine');
    sync.blur();
    expect(saves).toHaveLength(1);
    sync.setStored('theirs, newer'); // arrives while the save is running
    expect(shown).toEqual([]);
    saves[0]!.done();
    await vi.runAllTimersAsync();
    expect(shown).toEqual(['theirs, newer']);
  });

  it('after a save without news, nothing is shown again (no flash of the old text)', async () => {
    const { sync, shown, saves } = setup();
    sync.focus();
    sync.type('mine');
    sync.blur();
    saves[0]!.done();
    await vi.runAllTimersAsync();
    expect(shown).toEqual([]);
    sync.setStored('mine'); // the saved text comes back from the database: already on screen
    expect(shown).toEqual([]);
  });

  it('typing after a change arrived replaces it (latest edit wins), without a flash', async () => {
    const { sync, shown, saves } = setup();
    sync.focus();
    sync.type('a');
    sync.setStored('theirs'); // arrives while typing
    sync.type('ab'); // the user keeps typing: their text wins when saved
    sync.blur();
    saves.at(-1)!.done();
    await vi.runAllTimersAsync();
    expect(shown).toEqual([]);
    expect(saves.at(-1)!.text).toBe('ab');
  });

  it('the echo of an earlier own save does not replace newer text (review)', async () => {
    const { sync, shown, saves } = setup('');
    sync.focus();
    sync.type('a');
    vi.advanceTimersByTime(1000); // the save of "a" starts
    sync.type('ab');
    sync.setStored('a'); // the echo of the first save arrives late
    sync.blur(); // the save of "ab" starts
    saves[0]!.done();
    saves[1]!.done();
    await vi.runAllTimersAsync();
    expect(shown).toEqual([]);
    sync.setStored('ab'); // the echo of the last save
    expect(shown).toEqual([]);
    // Afterwards, changes from elsewhere are shown again.
    sync.setStored('from another device');
    expect(shown).toEqual(['from another device']);
  });

  it('an old echo arriving after the box is idle again is ignored too', async () => {
    const { sync, shown, saves } = setup('');
    sync.focus();
    sync.type('a');
    vi.advanceTimersByTime(1000);
    sync.type('ab');
    sync.blur();
    saves[0]!.done();
    saves[1]!.done();
    await vi.runAllTimersAsync();
    sync.setStored('a'); // late echo while idle
    expect(shown).toEqual([]);
  });

  it('a change from elsewhere during saves is still shown afterwards', async () => {
    const { sync, shown, saves } = setup('');
    sync.focus();
    sync.type('mine');
    sync.blur();
    sync.setStored('theirs');
    saves[0]!.done();
    await vi.runAllTimersAsync();
    expect(shown).toEqual(['theirs']);
  });

  it('dispose saves what was typed', () => {
    const { sync, saves } = setup();
    sync.focus();
    sync.type('unsaved');
    sync.dispose();
    expect(saves.map((s) => s.text)).toEqual(['unsaved']);
  });
});
