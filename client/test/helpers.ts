import { formatHlc, newId, syncOpSchema, type List } from '@todoness/shared';
import { TodonessDB } from '../src/data/db';
import { createRepo, type Repo } from '../src/data/repo';

export const T0 = 1_730_822_400_000;

let counter = 0;

/** A fresh, empty local database (each test gets its own). */
export function testDb() {
  return new TodonessDB(`test-${Date.now()}-${counter++}-${Math.random().toString(36).slice(2)}`);
}

/** A controllable clock: starts at T0 and only moves when the test says so. */
export function fakeNow(start = T0) {
  let t = start;
  const now = () => t;
  now.set = (v: number) => {
    t = v;
  };
  now.advance = (ms: number) => {
    t += ms;
  };
  return now;
}

export function testRepo(opts: { now?: () => number } = {}) {
  const db = testDb();
  const now = opts.now ?? fakeNow();
  const repo: Repo = createRepo(db, { now });
  return { db, repo, now };
}

/** The Inbox the server would deliver after sign-up. */
export async function seedInbox(db: TodonessDB, id = newId(T0)): Promise<List> {
  const hlc = formatHlc({ wall: T0 - 1000, counter: 0, clientId: 'server' });
  const inbox: List = {
    id,
    name: 'Inbox',
    isInbox: true,
    isPublic: false,
    orderKey: 'a0',
    fieldHlc: { name: hlc, orderKey: hlc, isInbox: hlc },
    createdAt: T0 - 1000,
    updatedAt: T0 - 1000,
    deletedAt: null,
  };
  await db.lists.put(inbox);
  return inbox;
}

/** Every pending operation must be something the server would accept. */
export async function expectValidOutbox(db: TodonessDB) {
  const ops = await db.outbox.toArray();
  for (const op of ops) {
    const { attempts, createdAt, ...wire } = op;
    void attempts;
    void createdAt;
    const r = syncOpSchema.safeParse(wire);
    if (!r.success)
      throw new Error(`invalid outbox op: ${JSON.stringify(wire)} ${r.error.message}`);
  }
  return ops;
}
