/**
 * Copies of other users' public lists and notes, kept on the device so they can be read
 * offline (docs/notes/PRD.md FR-106). Each refresh asks the server and stores the answer;
 * without an answer the old copy stays.
 */
import {
  publicListResponseSchema,
  publicListsResponseSchema,
  publicNotesResponseSchema,
  type PublicList,
} from '@todoness/shared';
import type { TodonessDB } from '../data/db';
import type { FetchFn } from '../sync/engine';

export const LISTS_KEY = 'lists';
export const NOTES_KEY = 'notes';
export const listKey = (id: string) => `list:${id}`;

export interface PublicData {
  /** True when the server answered (and the copy was replaced). */
  refreshLists(): Promise<boolean>;
  refreshList(id: string): Promise<boolean>;
  refreshNotes(): Promise<boolean>;
  /** Loads every known public list whose copy is older than `maxAgeMs`. */
  prefetchLists(maxAgeMs: number): Promise<void>;
}

/** A copy of a list that is no longer public is kept this long (an open page may show it). */
const KEEP_GONE_MS = 60_000;

export function createPublicData(deps: {
  db: TodonessDB;
  fetch: FetchFn;
  now?: () => number;
}): PublicData {
  const { db, fetch, now = Date.now } = deps;
  let prefetching: Promise<void> | undefined;

  /**
   * Asks the server and stores the answer under `key`. Sends the copy's ETag; 304 confirms
   * the copy. Nothing is stored if the copy changed while the request was under way (an edit
   * of this device was accepted and written into it): that answer is older (review fix).
   */
  async function refresh(
    key: string,
    url: string,
    parse: (body: unknown) => unknown,
    whenGone?: unknown,
  ): Promise<boolean> {
    const before = await db.publicCache.get(key);
    const rev = before?.rev ?? 0;
    let res: Response;
    try {
      res = await fetch(
        url,
        before?.etag ? { headers: { 'if-none-match': before.etag } } : undefined,
      );
    } catch {
      return false; // offline
    }

    let value: unknown;
    let etag: string | undefined;
    if (res.status === 304) {
      value = undefined;
    } else if (res.status === 404 && whenGone !== undefined) {
      value = whenGone;
    } else if (!res.ok) {
      return false;
    } else {
      value = parse(await res.json().catch(() => undefined));
      if (value === undefined) return false;
      etag = res.headers.get('etag') ?? undefined;
    }

    return db.transaction('rw', db.publicCache, async () => {
      const current = await db.publicCache.get(key);
      if ((current?.rev ?? 0) !== rev) return false;
      if (res.status === 304) {
        if (current) await db.publicCache.update(key, { at: now() });
        return current !== undefined;
      }
      await db.publicCache.put({ key, value, at: now(), rev, ...(etag ? { etag } : {}) });
      return true;
    });
  }

  const refreshList = (id: string) =>
    refresh(
      listKey(id),
      `/api/public/lists/${encodeURIComponent(id)}`,
      (body) => {
        const parsed = publicListResponseSchema.safeParse(body);
        return parsed.success ? parsed.data : undefined;
      },
      'gone',
    );

  /** Removes copies of lists that are no longer public (review fix: the cache kept growing). */
  async function forgetOldLists(lists: PublicList[]) {
    const listed = new Set(lists.map((l) => listKey(l.id)));
    const queued = new Set(
      (await db.publicOutbox.toArray())
        .filter((o) => o.target === 'list')
        .map((o) => listKey(o.targetId)),
    );
    const stale = (await db.publicCache.where('key').startsWith('list:').toArray()).filter(
      (r) => !listed.has(r.key) && !queued.has(r.key) && now() - r.at >= KEEP_GONE_MS,
    );
    await db.publicCache.bulkDelete(stale.map((r) => r.key));
  }

  return {
    async refreshLists() {
      const ok = await refresh(LISTS_KEY, '/api/public/lists', (body) => {
        const parsed = publicListsResponseSchema.safeParse(body);
        return parsed.success ? parsed.data.lists : undefined;
      });
      if (ok) {
        const lists = ((await db.publicCache.get(LISTS_KEY))?.value as PublicList[]) ?? [];
        await forgetOldLists(lists);
      }
      return ok;
    },

    refreshList,

    refreshNotes: () =>
      refresh(NOTES_KEY, '/api/public/notes', (body) => {
        const parsed = publicNotesResponseSchema.safeParse(body);
        return parsed.success ? parsed.data.notes : undefined;
      }),

    /** One run at a time (review fix): a second call while one runs waits for it. */
    prefetchLists(maxAgeMs) {
      prefetching ??= (async () => {
        const lists = ((await db.publicCache.get(LISTS_KEY))?.value as PublicList[]) ?? [];
        for (const l of lists) {
          const copy = await db.publicCache.get(listKey(l.id));
          if (copy && now() - copy.at < maxAgeMs) continue;
          if (!(await refreshList(l.id))) return; // no connection: try again later
        }
      })().finally(() => {
        prefetching = undefined;
      });
      return prefetching;
    },
  };
}
