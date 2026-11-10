/**
 * Reminders through ntfy (README, "Reminders through ntfy").
 * The server publishes the reminder to a topic on an ntfy server; the user subscribes to
 * that topic in the ntfy app. This file only manages the topic and talks to our server.
 */
import { ntfyStatusSchema, ntfyTopicSchema, type NtfyStatus } from '@todoness/shared';

export type { NtfyStatus };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const browserFetch: Fetch = (url, init) => fetch(url, init);

/** What the server says, or `undefined` if it cannot be reached or answers wrongly. */
export async function loadNtfyStatus(
  doFetch: Fetch = browserFetch,
): Promise<NtfyStatus | undefined> {
  try {
    const res = await doFetch('/api/ntfy');
    if (!res.ok) return undefined;
    const parsed = ntfyStatusSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    return ((await res.json()) as { error?: string }).error;
  } catch {
    return undefined;
  }
}

export type SaveResult = 'ok' | 'invalid' | 'taken' | 'disabled' | 'failed';

export async function saveNtfyTopic(
  topic: string,
  doFetch: Fetch = browserFetch,
): Promise<SaveResult> {
  const trimmed = topic.trim();
  if (!ntfyTopicSchema.safeParse(trimmed).success) return 'invalid';
  try {
    const res = await doFetch('/api/ntfy', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: trimmed }),
    });
    if (res.ok) return 'ok';
    if (res.status === 400) return 'invalid';
    const code = await errorCode(res);
    if (res.status === 409 && code === 'topic_taken') return 'taken';
    if (res.status === 409 && code === 'ntfy_disabled') return 'disabled';
    return 'failed';
  } catch {
    return 'failed';
  }
}

export async function removeNtfyTopic(doFetch: Fetch = browserFetch): Promise<boolean> {
  try {
    return (await doFetch('/api/ntfy', { method: 'DELETE' })).ok;
  } catch {
    return false;
  }
}

export type TestResult = 'ok' | 'no_topic' | 'disabled' | 'failed';

/** Asks the server to publish a test message, so the whole chain can be checked. */
export async function sendNtfyTest(doFetch: Fetch = browserFetch): Promise<TestResult> {
  try {
    const res = await doFetch('/api/ntfy/test', { method: 'POST' });
    if (res.ok) return 'ok';
    const code = await errorCode(res);
    if (res.status === 409 && code === 'no_topic') return 'no_topic';
    if (res.status === 409 && code === 'ntfy_disabled') return 'disabled';
    return 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * A topic nobody can guess. On a shared ntfy server the topic name is the only secret, so
 * "reminders" or "my-tasks" would let strangers read the user's reminders.
 */
export function randomNtfyTopic(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  // 256 is not a multiple of 36, so a plain modulo would favour the first letters a little;
  // that is harmless for a name that is only used as a hard-to-guess secret.
  return 'todoness-' + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** The address to open (or subscribe to) in the ntfy app. */
export function ntfySubscribeUrl(serverUrl: string, topic: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/${topic}`;
}
