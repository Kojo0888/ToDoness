/**
 * Reminders through ntfy (https://ntfy.sh): a plain HTTP POST to an ntfy server, which
 * can be your own on the local network. Used next to web push, not instead of it.
 */
import type { PushPayload } from './reminders';

/** There is no `gone`: an ntfy topic never expires, it just has no listener. */
export type NtfySend = (topic: string, payload: PushPayload) => Promise<'ok' | 'failed'>;

const TIMEOUT_MS = 10_000;

export function createNtfySender({
  url,
  token,
  publicUrl,
  /** Replaceable in tests. */
  fetch: doFetch = (...args) => fetch(...args),
}: {
  url: string;
  token?: string;
  publicUrl?: string;
  fetch?: typeof fetch;
}): NtfySend {
  return async (topic, payload) => {
    // JSON (not headers), so titles with non-ASCII characters arrive intact.
    const body = {
      topic,
      title: payload.title,
      message: payload.body,
      priority: 4,
      tags: ['alarm_clock'],
      ...(publicUrl ? { click: `${publicUrl}${payload.url}` } : {}),
    };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (res.ok) return 'ok';
      // Neither the topic (a secret on shared servers) nor the token goes into the log.
      console.warn(`ntfy at ${new URL(url).host} answered ${res.status}`);
      return 'failed';
    } catch (err) {
      console.warn(`ntfy at ${new URL(url).host} failed:`, (err as Error).message);
      return 'failed';
    } finally {
      clearTimeout(timer);
    }
  };
}
