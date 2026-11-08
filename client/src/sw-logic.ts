/**
 * The decisions the service worker makes about a push and a click on its notification.
 * Free of browser globals so it can be tested on its own (docs/v1/PRD.md FR-62, FR-66).
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Same tag the app uses for its own notification of this reminder. */
  tag: string;
  /** Where a click goes (a path inside the app). */
  url: string;
}

const FALLBACK: PushMessage = {
  title: 'ToDoness',
  body: 'You have a reminder.',
  tag: 'todoness-reminder',
  url: '/',
};

/** Only a path inside this app: anything else (another site, a script) becomes `/`. */
export function safeAppUrl(url: unknown): string {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}

const text = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;

/**
 * Reads what the server sent. A push must always end in a visible notification (browsers
 * punish silent pushes), so bad or missing data gives a generic reminder.
 */
export function parsePushPayload(raw: string | undefined): PushMessage {
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : undefined;
  } catch {
    data = undefined;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ...FALLBACK };
  const d = data as Record<string, unknown>;
  return {
    title: text(d.title, 200) ?? FALLBACK.title,
    body: text(d.body, 300) ?? '',
    tag: text(d.tag, 200) ?? FALLBACK.tag,
    url: safeAppUrl(d.url),
  };
}

export function notificationOptions(m: PushMessage) {
  return { body: m.body, tag: m.tag, icon: '/icon-192.png', data: { url: m.url } };
}

/** Which open window to bring forward when a notification is clicked (-1 = open a new one). */
export function chooseWindow(
  windows: readonly { focused?: boolean; visibilityState?: string }[],
): number {
  if (windows.length === 0) return -1;
  const focused = windows.findIndex((w) => w.focused);
  if (focused >= 0) return focused;
  const visible = windows.findIndex((w) => w.visibilityState === 'visible');
  return visible >= 0 ? visible : 0;
}
