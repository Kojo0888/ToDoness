/** Reading other users' public lists (online only; docs/v1/PRD.md FR-33 – FR-36). */
import {
  publicListResponseSchema,
  publicListsResponseSchema,
  type PublicList,
  type PublicListResponse,
} from '@todoness/shared';

export type PublicPage = PublicListResponse | 'gone';

export async function fetchPublicLists(): Promise<PublicList[] | undefined> {
  try {
    const res = await fetch('/api/public/lists');
    if (!res.ok) return undefined;
    const parsed = publicListsResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.lists : undefined;
  } catch {
    return undefined; // offline
  }
}

/** The list, `'gone'` if it is not public (any more), or `undefined` if the server cannot be reached. */
export async function fetchPublicList(id: string): Promise<PublicPage | undefined> {
  try {
    const res = await fetch(`/api/public/lists/${encodeURIComponent(id)}`);
    if (res.status === 404) return 'gone';
    if (!res.ok) return undefined;
    const parsed = publicListResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
