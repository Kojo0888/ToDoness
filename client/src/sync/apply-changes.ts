import {
  HlcClock,
  applyOp,
  newClientId,
  type List,
  type PullChange,
  type Todo,
} from '@todoness/shared';
import type { TodonessDB } from '../data/db';

/**
 * Applies changes received from the server in ONE transaction, then moves the
 * pull cursor and the local clock forward.
 *
 * Fields are merged with the same per-field "last write wins" rule the server
 * uses. Every local row remembers the clock of each field, so a pending local
 * edit that is newer than the incoming change stays, and an older one gives way.
 * Both sides then end with the same value once the pending edit has been sent.
 */
export async function applyChanges(
  db: TodonessDB,
  changes: PullChange[],
  nextSeq: number,
  now: () => number = Date.now,
): Promise<number> {
  return db.transaction('rw', [db.lists, db.todos, db.meta], async () => {
    let newest: string | undefined;

    for (const ch of changes) {
      const table = (ch.entity === 'todo' ? db.todos : db.lists) as unknown as {
        get(id: string): Promise<Todo | List | undefined>;
        put(row: Todo | List): Promise<unknown>;
      };
      const existing = await table.get(ch.entityId);
      const result = applyOp(existing, {
        entity: ch.entity,
        entityId: ch.entityId,
        type: ch.type,
        patch: ch.patch,
        hlc: ch.hlc,
      });
      // "Not found" / "missing fields": the row is not here (yet); nothing to do.
      if (result.ok && result.changed) await table.put(result.row);
      if (newest === undefined || ch.hlc > newest) newest = ch.hlc;
    }

    if (newest !== undefined) {
      let clientId = await db.getMeta<string>('clientId');
      if (!clientId) {
        clientId = newClientId();
        await db.setMeta('clientId', clientId);
      }
      const last = await db.getMeta<string>('lastHlc');
      await db.setMeta('lastHlc', new HlcClock(clientId, now, last).receive(newest));
    }

    const cursor = (await db.getMeta<number>('lastServerSeq')) ?? 0;
    if (nextSeq > cursor) await db.setMeta('lastServerSeq', nextSeq);

    return changes.length;
  });
}
