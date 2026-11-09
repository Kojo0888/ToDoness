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

export function createPublicData(deps: {
  db: TodonessDB;
  fetch: FetchFn;
  now?: () => number;
}): PublicData {
  const { db, fetch, now = Date.now } = deps;

  async function get(url: string): Promise<Response | undefined> {
    try {
      return await fetch(url);
    } catch {
      return undefined; // offline
    }
  }

  const store = (key: string, value: unknown) => db.publicCache.put({ key, value, at: now() });

  async function refreshList(id: string) {
    const res = await get(`/api/public/lists/${encodeURIComponent(id)}`);
    if (!res) return false;
    if (res.status === 404) {
      await store(listKey(id), 'gone');
      return true;
    }
    if (!res.ok) return false;
    const parsed = publicListResponseSchema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) return false;
    await store(listKey(id), parsed.data);
    return true;
  }

  return {
    async refreshLists() {
      const res = await get('/api/public/lists');
      if (!res?.ok) return false;
      const parsed = publicListsResponseSchema.safeParse(await res.json().catch(() => undefined));
      if (!parsed.success) return false;
      await store(LISTS_KEY, parsed.data.lists);
      return true;
    },

    refreshList,

    async refreshNotes() {
      const res = await get('/api/public/notes');
      if (!res?.ok) return false;
      const parsed = publicNotesResponseSchema.safeParse(await res.json().catch(() => undefined));
      if (!parsed.success) return false;
      await store(NOTES_KEY, parsed.data.notes);
      return true;
    },

    async prefetchLists(maxAgeMs) {
      const lists = ((await db.publicCache.get(LISTS_KEY))?.value as PublicList[]) ?? [];
      for (const l of lists) {
        const copy = await db.publicCache.get(listKey(l.id));
        if (copy && now() - copy.at < maxAgeMs) continue;
        if (!(await refreshList(l.id))) return; // no connection: try again later
      }
    },
  };
}
