import { describe, expect, it } from 'vitest';
import { chooseWindow, notificationOptions, parsePushPayload, safeAppUrl } from '../src/sw-logic';

describe('parsePushPayload (FR-62)', () => {
  const good = { title: 'Dentist', body: 'Due in 1 hour', tag: 't:1:hour', url: '/l/1/t/2' };

  it('reads what the server sends', () => {
    expect(parsePushPayload(JSON.stringify(good))).toEqual(good);
  });

  it('never drops a push: bad or missing data gives a generic reminder', () => {
    for (const raw of [undefined, '', 'not json', '[]', 'null', '42', '{"title":5}']) {
      const m = parsePushPayload(raw);
      expect(m.title.length, String(raw)).toBeGreaterThan(0);
      expect(m.url).toBe('/');
    }
  });

  it('fills in what is missing and keeps what is valid', () => {
    expect(parsePushPayload('{"title":"Only a title"}')).toMatchObject({
      title: 'Only a title',
      url: '/',
    });
  });

  it('shortens very long text', () => {
    const m = parsePushPayload(
      JSON.stringify({ ...good, title: 'x'.repeat(1000), body: 'y'.repeat(1000) }),
    );
    expect(m.title.length).toBeLessThanOrEqual(200);
    expect(m.body.length).toBeLessThanOrEqual(300);
  });
});

describe('safeAppUrl', () => {
  it('only allows paths inside the app', () => {
    expect(safeAppUrl('/l/1/t/2')).toBe('/l/1/t/2');
    expect(safeAppUrl('/')).toBe('/');
    for (const bad of [
      'https://evil.example/',
      '//evil.example',
      'javascript:alert(1)',
      '',
      5,
      null,
      undefined,
      'l/1',
    ]) {
      expect(safeAppUrl(bad), String(bad)).toBe('/');
    }
  });
});

describe('notificationOptions (FR-66)', () => {
  it('uses the reminder key as tag, so the app’s own notification is replaced, not doubled', () => {
    const o = notificationOptions({ title: 'T', body: 'B', tag: 'k:1:day', url: '/l/1/t/2' });
    expect(o).toMatchObject({ body: 'B', tag: 'k:1:day', data: { url: '/l/1/t/2' } });
    expect(o.icon).toBe('/icon-192.png');
  });
});

describe('chooseWindow (FR-62)', () => {
  it('prefers a focused window, then a visible one, then any, else none', () => {
    const w = (focused: boolean, visible: boolean) => ({
      focused,
      visibilityState: visible ? 'visible' : 'hidden',
    });
    expect(chooseWindow([w(false, false), w(true, true), w(false, true)])).toBe(1);
    expect(chooseWindow([w(false, false), w(false, true)])).toBe(1);
    expect(chooseWindow([w(false, false), w(false, false)])).toBe(0);
    expect(chooseWindow([])).toBe(-1);
  });
});
