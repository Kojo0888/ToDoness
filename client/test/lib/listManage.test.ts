/** The "Manage lists" page. */
import { describe, expect, it } from 'vitest';
import { MANAGE_LISTS_PATH } from '../../src/lib/listManage';

describe('the page address', () => {
  it('is /lists/manage', () => {
    expect(MANAGE_LISTS_PATH).toBe('/lists/manage');
  });
});

describe('note list addresses (docs/note-lists)', () => {
  it('live in the Notes module', async () => {
    const { MANAGE_NOTE_LISTS_PATH, noteListPath } = await import('../../src/lib/listManage');
    const { moduleOfPath } = await import('../../src/lib/modules');
    expect(moduleOfPath(MANAGE_NOTE_LISTS_PATH)).toBe('notes');
    expect(moduleOfPath(noteListPath('abc'))).toBe('notes');
  });
});
