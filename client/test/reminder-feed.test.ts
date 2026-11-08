import { describe, expect, it, vi } from 'vitest';
import { createReminderFeed } from '../src/app/reminderFeed';

const msg = (key: string) => ({ key, title: 'T', body: 'B', href: '/l/1/t/2' });

describe('reminder feed (in-app messages)', () => {
  it('collects messages and lets them be dismissed', () => {
    const feed = createReminderFeed();
    feed.push(msg('a'));
    feed.push(msg('b'));
    expect(feed.getSnapshot().map((m) => m.key)).toEqual(['a', 'b']);
    feed.dismiss('a');
    expect(feed.getSnapshot().map((m) => m.key)).toEqual(['b']);
  });

  it('shows the same reminder only once', () => {
    const feed = createReminderFeed();
    feed.push(msg('a'));
    feed.push(msg('a'));
    expect(feed.getSnapshot()).toHaveLength(1);
  });

  it('notifies subscribers, and gives a new snapshot object on each change', () => {
    const feed = createReminderFeed();
    const listener = vi.fn();
    const off = feed.subscribe(listener);
    const first = feed.getSnapshot();
    feed.push(msg('a'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(feed.getSnapshot()).not.toBe(first);
    off();
    feed.dismiss('a');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
