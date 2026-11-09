import { formatHlc, newId } from '@todoness/shared';

export interface Call {
  url: string;
  method: string;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type Reply = Response | 'network-error';

/** A scripted `fetch`: the handler decides what each request gets. */
export function fakeFetch(handler: (call: Call, index: number) => Reply | Promise<Reply>) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const reply = await handler(call, calls.length - 1);
    if (reply === 'network-error') throw new TypeError('Failed to fetch');
    return reply;
  };
  return Object.assign(fn, { calls });
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const hlcAt = (wall: number, clientId = 'bbbb', counter = 0) =>
  formatHlc({ wall, counter, clientId });

let seq = 0;
export function listChange(over: Record<string, unknown> = {}) {
  return {
    serverSeq: ++seq,
    entity: 'list',
    entityId: newId(),
    type: 'create',
    patch: { name: 'Work', orderKey: 'a1' },
    hlc: hlcAt(1_730_822_400_000),
    ...over,
  };
}

export function todoChange(listId: string, over: Record<string, unknown> = {}) {
  return {
    serverSeq: ++seq,
    entity: 'todo',
    entityId: newId(),
    type: 'create',
    patch: { listId, title: 'From server', orderKey: 'a0' },
    hlc: hlcAt(1_730_822_400_000),
    ...over,
  };
}

export const pullBody = (changes: unknown[], hasMore = false, nextSeq?: number) => ({
  changes,
  nextSeq: nextSeq ?? (changes.at(-1) as { serverSeq: number } | undefined)?.serverSeq ?? 0,
  hasMore,
});

export function noteChange(over: Record<string, unknown> = {}) {
  return {
    serverSeq: ++seq,
    entity: 'note',
    entityId: newId(),
    type: 'create',
    patch: { text: 'From server', orderKey: 'a0' },
    hlc: hlcAt(1_730_822_400_000),
    ...over,
  };
}
