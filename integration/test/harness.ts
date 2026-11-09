/**
 * Simulated browsers talking to the real server (in memory).
 * Each browser has its own local database, clock and cookies. The "network" can
 * be switched off, or made to lose the server's answer after the server has
 * already applied a request.
 */
import type { Hono } from 'hono';
import { HlcClock } from '@todoness/shared';
import { createApp } from '../../server/src/app';
import { loadConfig } from '../../server/src/config';
import { openDatabase } from '../../server/src/db/connection';
import { migrate, MIGRATIONS_DIR } from '../../server/src/db/migrate';
import { TodonessDB } from '../../client/src/data/db';
import { createRepo, type Repo } from '../../client/src/data/repo';
import { getLists, getOpenTodos } from '../../client/src/data/queries';
import { createSyncEngine, type SyncEngine } from '../../client/src/sync/engine';

export const T0 = 1_730_822_400_000;
export const PW = 'correct horse';

/**
 * The server shares the simulated time base (a minute before T0), so the
 * browsers' clocks are not pushed into the real present by its timestamps.
 */
export function startServer(opts: { now?: () => number } = {}) {
  const db = openDatabase(':memory:');
  migrate(db, MIGRATIONS_DIR);
  const app = createApp({ db, config: loadConfig({}), now: opts.now ?? (() => T0 - 60_000) });
  return { app: app as Hono<any>, db }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
export type Server = ReturnType<typeof startServer>;

let counter = 0;

export class Browser {
  readonly db = new TodonessDB(
    `it-${Date.now()}-${counter++}-${Math.random().toString(36).slice(2)}`,
  );
  readonly repo: Repo;
  readonly engine: SyncEngine;
  readonly cookies = new Map<string, string>();

  /** The device clock (epoch ms). Move it to simulate a wrong clock. */
  time = T0;
  /** `false` = no connection at all. */
  online = true;
  /** Lose the answer to the next request(s) after the server has handled them. */
  loseNextResponses = 0;
  /** Number of requests that reached the server. */
  requests: string[] = [];

  constructor(
    public server: Server,
    readonly label = 'browser',
    opts: { batchSize?: number } = {},
  ) {
    const now = () => this.time;
    this.repo = createRepo(this.db, { now });
    this.engine = createSyncEngine({ db: this.db, fetch: this.fetch, now, ...opts });
  }

  fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    if (!this.online) throw new TypeError('Failed to fetch');
    const headers = new Headers(init.headers);
    if (this.cookies.size) {
      headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    }
    this.requests.push(`${init.method ?? 'GET'} ${url}`);
    const res = await this.server.app.request(url, { ...init, headers });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const [name, ...rest] = pair!.split('=');
      const value = rest.join('=');
      if (value === '' || /max-age=0/i.test(line)) this.cookies.delete(name!);
      else this.cookies.set(name!, value);
    }
    if (this.loseNextResponses > 0) {
      this.loseNextResponses--;
      throw new TypeError('Connection lost');
    }
    return res;
  };

  /** The server lost its database and a fresh one took its place: old cookies mean nothing. */
  switchServer(server: Server) {
    this.server = server;
    this.cookies.clear();
  }

  private async auth(path: string, email: string, password = PW) {
    const res = await this.fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`${path} failed with ${res.status}`);
    return (await res.json()) as { id: string; email: string; role: string };
  }

  /** Signs up and does the first full pull, as the app does after login. */
  async register(email: string) {
    const me = await this.auth('/api/auth/register', email);
    await this.db.setMeta('userId', me.id);
    await this.sync();
    return me;
  }

  async login(email: string, password = PW) {
    const me = await this.auth('/api/auth/login', email, password);
    await this.db.setMeta('userId', me.id);
    return me;
  }

  sync() {
    return this.engine.sync();
  }

  /** The Inbox id (arrives from the server). */
  async inboxId(): Promise<string> {
    const inbox = (await getLists(this.db)).find((l) => l.isInbox);
    if (!inbox) throw new Error(`${this.label} has no Inbox yet`);
    return inbox.id;
  }

  /** Titles of the open todos of a list, top first. */
  async titles(listId: string): Promise<string[]> {
    return (await getOpenTodos(this.db, listId)).map((t) => t.title);
  }

  /** Everything stored locally, for comparing two browsers. */
  async snapshot() {
    const byId = <T extends { id: string }>(rows: T[]) =>
      rows.sort((a, b) => a.id.localeCompare(b.id));
    return {
      lists: byId(await this.db.lists.toArray()),
      todos: byId(await this.db.todos.toArray()),
    };
  }

  /** A clock helper for tests that need to forge timestamps. */
  clock(clientId = 'forge') {
    return new HlcClock(clientId, () => this.time);
  }
}

/** Two browsers of the same user, both logged in and in sync. */
export async function twoBrowsers(server = startServer(), email = 'ann@corp.test') {
  const a = new Browser(server, 'laptop');
  const b = new Browser(server, 'phone');
  await a.register(email);
  await b.login(email);
  await b.sync();
  return { server, a, b, inbox: await a.inboxId() };
}
