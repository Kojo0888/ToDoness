/**
 * Other users' public lists and notes as the screens show them: the last copy from the
 * server with this device's queued changes on top (docs/notes/PRD.md FR-106 – FR-110).
 * While the server can be reached the copy is refreshed every few seconds and after every
 * sync (which is when queued changes have just been sent).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import type { PublicList, PublicListResponse, PublicNote } from '@todoness/shared';
import type { DeadLetter } from '../data/db';
import { overlayListPage, overlayNotes } from '../data/publicOverlay';
import { LISTS_KEY, listKey, NOTES_KEY } from '../services/publicData';
import { db, publicData } from './container';
import { usePolled, useSyncStatus } from './hooks';

const REFRESH_MS = 5000;
/** Every public list in the sidebar is loaded in the background about this often. */
const PREFETCH_MS = 60_000;

/**
 * Polls `refresh` and runs it again after every sync. `failed` = no answer last time.
 * `enabled: false` only reads the copy: another part of the screen already refreshes it.
 */
function useRefresh(refresh: () => Promise<boolean>, key: string, enabled = true) {
  const { failed, reload } = usePolled(
    async () => (!enabled || (await refresh()) ? true : undefined),
    REFRESH_MS,
    `${key}:${enabled}`,
  );
  const { lastSyncAt } = useSyncStatus();
  useEffect(() => {
    if (lastSyncAt !== null) reload();
  }, [lastSyncAt, reload]);
  return failed;
}

export interface PublicView<T> {
  /** `undefined` = still reading the device; `null` = never loaded on this device. */
  value: T | null | undefined;
  /** When the copy came from the server. */
  at: number | null;
  /** The last refresh got no answer (offline). */
  failed: boolean;
  /** Changes waiting to be sent. */
  pending: number;
  /** Changes the server refused (FR-109). */
  refused: DeadLetter[];
}

/** Forgets refused changes once the user has read about them. */
export const dismissRefused = (refused: DeadLetter[]) =>
  db.deadLetter.bulkDelete(refused.map((d) => d.opId));

/** `lists`: `undefined` = still reading, `null` = never loaded on this device. */
export function usePublicLists(): { lists: PublicList[] | null | undefined; failed: boolean } {
  const failed = useRefresh(async () => {
    const ok = await publicData.refreshLists();
    if (ok) void publicData.prefetchLists(PREFETCH_MS);
    return ok;
  }, 'lists');
  const lists = useLiveQuery(
    async () => ((await db.publicCache.get(LISTS_KEY))?.value as PublicList[] | undefined) ?? null,
    [],
  );
  return { lists, failed };
}

export function usePublicList(listId: string): PublicView<PublicListResponse | 'gone'> {
  const failed = useRefresh(() => publicData.refreshList(listId), `list:${listId}`);
  const data = useLiveQuery(async () => {
    const row = await db.publicCache.get(listKey(listId));
    const ops = await db.publicOutbox.where('targetId').equals(listId).toArray();
    const refused = (await db.deadLetter.toArray()).filter((d) => d.targetId === listId);
    return { row: row ?? null, ops, refused };
  }, [listId]);

  if (!data) return { value: undefined, at: null, failed, pending: 0, refused: [] };
  const raw = data.row?.value as PublicListResponse | 'gone' | undefined;
  return {
    value: raw === undefined ? null : raw === 'gone' ? 'gone' : overlayListPage(raw, data.ops),
    at: data.row?.at ?? null,
    failed,
    pending: data.ops.length,
    refused: data.refused,
  };
}

export function usePublicNotes(opts: { refresh?: boolean } = {}): PublicView<PublicNote[]> {
  const failed = useRefresh(() => publicData.refreshNotes(), 'notes', opts.refresh ?? true);
  const data = useLiveQuery(async () => {
    const row = await db.publicCache.get(NOTES_KEY);
    const ops = (await db.publicOutbox.toArray()).filter((o) => o.target === 'note');
    const refused = (await db.deadLetter.toArray()).filter((d) => d.target === 'note');
    return { row: row ?? null, ops, refused };
  }, []);

  if (!data) return { value: undefined, at: null, failed, pending: 0, refused: [] };
  const raw = data.row?.value as PublicNote[] | undefined;
  return {
    value: raw === undefined ? null : overlayNotes(raw, data.ops),
    at: data.row?.at ?? null,
    failed,
    pending: data.ops.length,
    refused: data.refused,
  };
}
