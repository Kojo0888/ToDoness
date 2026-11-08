import { HlcClock, newClientId } from '@todoness/shared';
import type { TodonessDB } from './db';

/** Next clock value for this browser; remembered in `meta` so it survives reloads. */
export async function nextHlc(db: TodonessDB, now: () => number): Promise<string> {
  let clientId = await db.getMeta<string>('clientId');
  if (!clientId) {
    clientId = newClientId();
    await db.setMeta('clientId', clientId);
  }
  const last = await db.getMeta<string>('lastHlc');
  const hlc = new HlcClock(clientId, now, last).now();
  await db.setMeta('lastHlc', hlc);
  return hlc;
}
