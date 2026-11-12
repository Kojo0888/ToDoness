import type { Hono } from 'hono';
import {
  formatHlc,
  newId,
  pullResponseSchema,
  pushResponseSchema,
  type PullResponse,
  type PushResponse,
} from '@todoness/shared';
import { TestClient, type TestResponse } from './client';

export const T0 = 1_730_822_400_000;
export const PW = 'correct horse';

/** HLC with an explicit time (T0 + n ms), so conflict tests are deterministic. */
export const hlcAt = (n: number, clientId = 'aaaa', counter = 0) =>
  formatHlc({ wall: T0 + n, counter, clientId });

export interface Op {
  opId: string;
  entity: 'todo' | 'list' | 'note' | 'plan' | 'activity';
  entityId: string;
  type: 'create' | 'update' | 'delete' | 'restore';
  patch: Record<string, unknown>;
  hlc: string;
}

export function op(
  entity: Op['entity'],
  type: Op['type'],
  entityId: string,
  patch: Record<string, unknown>,
  hlc: string,
): Op {
  return { opId: newId(), entity, entityId, type, patch, hlc };
}

/** A browser of one user: a logged-in client plus helpers to push and pull. */
export class Device {
  constructor(
    readonly http: TestClient,
    readonly clientId = 'aaaa',
  ) {}

  rawPush(body: unknown): Promise<TestResponse> {
    return this.http.post('/api/sync/push', body);
  }

  async push(ops: unknown[]): Promise<PushResponse> {
    const res = await this.rawPush({ clientId: this.clientId, ops });
    if (res.status !== 200) throw new Error(`push failed with ${res.status}`);
    return pushResponseSchema.parse(await res.json());
  }

  async pull(since = 0, limit?: number): Promise<PullResponse> {
    // `reminders=list`, `lists=modules` and `plans=1`: like the current app, which understands
    // several reminders per task, note lists and the Plan module.
    const q = `since=${since}${limit === undefined ? '' : `&limit=${limit}`}&reminders=list&lists=modules&plans=1`;
    const res = await this.http.get(`/api/sync/pull?${q}`);
    if (res.status !== 200) throw new Error(`pull failed with ${res.status}`);
    return pullResponseSchema.parse(await res.json());
  }

  /** Pulls everything. */
  async pullAll() {
    return (await this.pull(0, 1000)).changes;
  }

  async inboxId(): Promise<string> {
    const changes = await this.pullAll();
    const inbox = changes.find(
      (c) =>
        c.entity === 'list' &&
        'isInbox' in c.patch &&
        c.patch.isInbox &&
        c.patch.module !== 'notes',
    );
    if (!inbox) throw new Error('no inbox');
    return inbox.entityId;
  }
}

export async function registerDevice(
  app: Hono<any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  email: string,
  clientId = 'aaaa',
) {
  const http = new TestClient(app);
  const res = await http.post('/api/auth/register', { email, password: PW });
  if (res.status !== 201) throw new Error(`register failed with ${res.status}`);
  return { device: new Device(http, clientId), me: await res.json() };
}

/** Second browser of an existing user. */
export async function loginDevice(
  app: Hono<any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  email: string,
  clientId: string,
) {
  const http = new TestClient(app);
  const res = await http.post('/api/auth/login', { email, password: PW });
  if (res.status !== 200) throw new Error(`login failed with ${res.status}`);
  return new Device(http, clientId);
}
