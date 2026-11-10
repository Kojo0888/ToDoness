/** The "Manage lists" page. */
import { describe, expect, it } from 'vitest';
import { MANAGE_LISTS_PATH } from '../../src/lib/listManage';

describe('the page address', () => {
  it('is /lists/manage', () => {
    expect(MANAGE_LISTS_PATH).toBe('/lists/manage');
  });
});
