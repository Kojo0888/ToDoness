/** `web-push` (v4) is an ES module with named exports only: its namespace is the API. */
import * as webpushModule from 'web-push';

export const webpush: typeof import('web-push') = webpushModule;
