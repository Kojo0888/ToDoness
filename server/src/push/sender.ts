import { webpush } from './webpush';
import type { PushSend } from './reminders';
import type { VapidKeys } from './keys';

/** Sends through the browser vendor's push service (outbound HTTPS from the server). */
export function createWebPushSender(
  keys: VapidKeys,
  subject: string,
  /** Replaceable in tests. */
  deliver: typeof webpush.sendNotification = (...args) => webpush.sendNotification(...args),
): PushSend {
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  return async (target, payload) => {
    try {
      await deliver(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60, urgency: 'high' },
      );
      return 'ok';
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      console.warn(`Push to ${new URL(target.endpoint).host} failed:`, (err as Error).message);
      return 'failed';
    }
  };
}
