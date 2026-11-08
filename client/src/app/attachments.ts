/** Talking to the attachments API (online only; docs/v1/PRD.md section 4.5). */
import {
  attachmentSchema,
  attachmentsResponseSchema,
  configResponseSchema,
  type Attachment,
} from '@todoness/shared';

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** `1536` → `1.5 KB`. */
export function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1);
  return `${text} ${UNITS[unit]}`;
}

export function checkFileSize(size: number, maxBytes: number): 'ok' | 'empty' | 'too_large' {
  if (size === 0) return 'empty';
  return size > maxBytes ? 'too_large' : 'ok';
}

// ---------------------------------------------------------------------------
// Config (the size limit comes from the server)
// ---------------------------------------------------------------------------

let cachedMax: number | undefined;

/** The largest allowed file in bytes, or `undefined` if the server cannot be reached. */
export async function fetchMaxAttachmentBytes(): Promise<number | undefined> {
  if (cachedMax !== undefined) return cachedMax;
  try {
    const res = await fetch('/api/config');
    const parsed = configResponseSchema.safeParse(await res.json());
    if (res.ok && parsed.success) cachedMax = parsed.data.maxAttachmentBytes;
  } catch {
    /* offline */
  }
  return cachedMax;
}

// ---------------------------------------------------------------------------
// List and remove
// ---------------------------------------------------------------------------

export const downloadUrl = (id: string) => `/api/attachments/${encodeURIComponent(id)}`;

/** `undefined` = could not be loaded (offline, or the task is not on the server yet). */
export async function fetchAttachments(todoId: string): Promise<Attachment[] | undefined> {
  try {
    const res = await fetch(`/api/todos/${encodeURIComponent(todoId)}/attachments`);
    if (res.status === 404) return []; // not on the server yet: no files can exist
    if (!res.ok) return undefined;
    const parsed = attachmentsResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.attachments : undefined;
  } catch {
    return undefined;
  }
}

export async function removeAttachment(id: string): Promise<boolean> {
  try {
    const res = await fetch(downloadUrl(id), { method: 'DELETE' });
    return res.status === 204 || res.status === 404;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Upload (XMLHttpRequest, because `fetch` cannot report upload progress)
// ---------------------------------------------------------------------------

/** The small part of XMLHttpRequest we use (so tests can replace it). */
export interface XhrLike {
  status: number;
  responseText: string;
  upload: {
    onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null;
  };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: unknown): void;
  abort(): void;
}

export type UploadError =
  | 'too_large'
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'invalid'
  | 'server'
  | 'network'
  | 'cancelled';

export type UploadResult = { ok: true; attachment: Attachment } | { ok: false; error: UploadError };

const ERRORS: Record<number, UploadError> = {
  413: 'too_large',
  404: 'not_found',
  401: 'unauthorized',
  403: 'forbidden',
  400: 'invalid',
};

export interface UploadOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  createXhr?: () => XhrLike;
}

export function uploadAttachment(
  todoId: string,
  file: File,
  {
    onProgress,
    signal,
    createXhr = () => new XMLHttpRequest() as unknown as XhrLike,
  }: UploadOptions = {},
): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = createXhr();
    xhr.open(
      'POST',
      `/api/todos/${encodeURIComponent(todoId)}/attachments?name=${encodeURIComponent(file.name)}`,
    );
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = attachmentSchema.safeParse(JSON.parse(xhr.responseText));
          if (parsed.success) return resolve({ ok: true, attachment: parsed.data });
        } catch {
          /* fall through */
        }
        return resolve({ ok: false, error: 'server' });
      }
      resolve({ ok: false, error: ERRORS[xhr.status] ?? 'server' });
    };
    xhr.onerror = () => resolve({ ok: false, error: 'network' });
    xhr.onabort = () => resolve({ ok: false, error: 'cancelled' });
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    xhr.send(file);
  });
}
