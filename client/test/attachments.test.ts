import { describe, expect, it, vi } from 'vitest';
import {
  attachmentPickers,
  checkFileSize,
  formatSize,
  uploadAttachment,
  type XhrLike,
} from '../src/app/attachments';

describe('formatSize', () => {
  it('uses B, KB, MB and GB with sensible decimals', () => {
    const cases: [number, string][] = [
      [0, '0 B'],
      [1023, '1023 B'],
      [1024, '1.0 KB'],
      [1536, '1.5 KB'],
      [10 * 1024, '10 KB'],
      [1024 * 1024, '1.0 MB'],
      [100 * 1024 * 1024, '100 MB'],
      [1024 ** 3, '1.0 GB'],
    ];
    for (const [n, text] of cases) expect(formatSize(n), String(n)).toBe(text);
  });
});

describe('checkFileSize (FR-49)', () => {
  const max = 1024 * 1024;
  it('accepts up to and including the limit', () => {
    expect(checkFileSize(1, max)).toBe('ok');
    expect(checkFileSize(max, max)).toBe('ok');
  });
  it('refuses empty and too large files', () => {
    expect(checkFileSize(0, max)).toBe('empty');
    expect(checkFileSize(max + 1, max)).toBe('too_large');
  });
});

/** A scripted XMLHttpRequest. */
function fakeXhr(reply: (xhr: FakeXhr) => void) {
  class FakeXhr implements XhrLike {
    status = 0;
    responseText = '';
    upload: {
      onprogress:
        ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null;
    } = {
      onprogress: null,
    };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    headers: Record<string, string> = {};
    opened: [string, string] | undefined;
    sent: unknown;
    open(method: string, url: string) {
      this.opened = [method, url];
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    }
    send(body: unknown) {
      this.sent = body;
      queueMicrotask(() => reply(this));
    }
    abort() {
      this.onabort?.();
    }
  }
  const instance = new FakeXhr();
  return { xhr: instance, create: () => instance as XhrLike };
}
type FakeXhr = ReturnType<typeof fakeXhr>['xhr'];

const file = (name = 'notes.txt', type = 'text/plain') => new File(['hello'], name, { type });
const META = {
  id: '0192f0c1-0000-7000-8000-00000000000a',
  name: 'notes.txt',
  size: 5,
  contentType: 'text/plain',
  createdAt: 1,
};

describe('uploadAttachment', () => {
  it('posts the file with its name and type and returns the attachment', async () => {
    const f = file('my notes.txt');
    const { xhr, create } = fakeXhr((x) => {
      x.status = 201;
      x.responseText = JSON.stringify(META);
      x.onload?.();
    });
    const result = await uploadAttachment('T1', f, { createXhr: create });
    expect(result).toEqual({ ok: true, attachment: META });
    expect(xhr.opened).toEqual(['POST', '/api/todos/T1/attachments?name=my%20notes.txt']);
    expect(xhr.headers['content-type']).toBe('text/plain');
    expect(xhr.sent).toBe(f);
  });

  it('uses a generic type for files without one', async () => {
    const { xhr, create } = fakeXhr((x) => {
      x.status = 201;
      x.responseText = JSON.stringify(META);
      x.onload?.();
    });
    await uploadAttachment('T1', file('x.bin', ''), { createXhr: create });
    expect(xhr.headers['content-type']).toBe('application/octet-stream');
  });

  it('reports progress as a fraction', async () => {
    const seen: number[] = [];
    const { create } = fakeXhr((x) => {
      x.upload.onprogress?.({ loaded: 1, total: 4, lengthComputable: true });
      x.upload.onprogress?.({ loaded: 4, total: 4, lengthComputable: true });
      x.status = 201;
      x.responseText = JSON.stringify(META);
      x.onload?.();
    });
    await uploadAttachment('T1', file(), { createXhr: create, onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([0.25, 1]);
  });

  it('maps server answers to clear errors', async () => {
    const cases: [number, string][] = [
      [413, 'too_large'],
      [404, 'not_found'],
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [400, 'invalid'],
      [500, 'server'],
    ];
    for (const [status, error] of cases) {
      const { create } = fakeXhr((x) => {
        x.status = status;
        x.responseText = '{}';
        x.onload?.();
      });
      expect(await uploadAttachment('T1', file(), { createXhr: create }), String(status)).toEqual({
        ok: false,
        error,
      });
    }
  });

  it('a broken connection is a network error', async () => {
    const { create } = fakeXhr((x) => x.onerror?.());
    expect(await uploadAttachment('T1', file(), { createXhr: create })).toEqual({
      ok: false,
      error: 'network',
    });
  });

  it('an unreadable success answer counts as a server problem', async () => {
    const { create } = fakeXhr((x) => {
      x.status = 201;
      x.responseText = 'not json';
      x.onload?.();
    });
    expect(await uploadAttachment('T1', file(), { createXhr: create })).toEqual({
      ok: false,
      error: 'server',
    });
  });

  it('can be cancelled', async () => {
    const abort = new AbortController();
    const { xhr, create } = fakeXhr(() => undefined);
    const spy = vi.spyOn(xhr, 'abort');
    const p = uploadAttachment('T1', file(), { createXhr: create, signal: abort.signal });
    abort.abort();
    expect(await p).toEqual({ ok: false, error: 'cancelled' });
    expect(spy).toHaveBeenCalled();
  });
});

describe('file pickers (phones must not offer recording)', () => {
  it('on a computer: one picker for any file', () => {
    expect(attachmentPickers(false)).toEqual([{ id: 'files', accept: undefined }]);
  });

  it('on a phone: photos/videos and documents, and no audio or "any file"', () => {
    const pickers = attachmentPickers(true);
    expect(pickers.map((p) => p.id)).toEqual(['media', 'documents']);
    expect(pickers[0]!.accept).toBe('image/*,video/*');
    for (const p of pickers) {
      expect(p.accept, p.id).toBeDefined();
      // Android shows a sound recorder for audio, and every recorder for "any file".
      expect(p.accept).not.toMatch(/audio|\*\/\*/);
    }
    expect(pickers[1]!.accept).toMatch(/application\/\*/);
  });
});
