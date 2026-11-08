/** `web-push` is a CommonJS package; this gives the same object however it is imported. */
import * as ns from 'web-push';

type WebPush = typeof import('web-push');
export const webpush: WebPush = (ns as unknown as { default?: WebPush }).default ?? (ns as WebPush);
