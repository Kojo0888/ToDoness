import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Attachment } from '@todoness/shared';
import {
  checkFileSize,
  downloadUrl,
  fetchAttachments,
  fetchMaxAttachmentBytes,
  formatSize,
  removeAttachment,
  uploadAttachment,
} from '../attachments';
import { useOnline } from '../hooks';
import { db, engine } from '../services';
import { t } from '../strings';

/** Names with download links, for read-only places (public lists). */
export function AttachmentLinks({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="attachment-list" aria-label={t.attachments.title}>
      {attachments.map((a) => (
        <li key={a.id}>
          <a href={downloadUrl(a.id)} download={a.name} title={t.attachments.download(a.name)}>
            {a.name}
          </a>{' '}
          <span className="hint">{formatSize(a.size)}</span>
        </li>
      ))}
    </ul>
  );
}

interface Running {
  name: string;
  progress: number;
}

/** The owner's attachments of one task: list, add, remove (FR-48 – FR-55). */
export function AttachmentsSection({ todoId }: { todoId: string }) {
  const online = useOnline();
  const [items, setItems] = useState<Attachment[] | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [max, setMax] = useState<number | undefined>(undefined);
  const [running, setRunning] = useState<Running | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const list = await fetchAttachments(todoId);
    setLoadFailed(list === undefined);
    if (list !== undefined) setItems(list);
  }, [todoId]);

  useEffect(() => {
    if (!online) return;
    // Fetching is the point of this effect: the state changes when the answers arrive.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    void fetchMaxAttachmentBytes().then(setMax);
  }, [online, reload]);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = ''; // so the same file can be picked again
    setError(null);
    if (files.length === 0) return;

    const limit = max ?? (await fetchMaxAttachmentBytes());
    // The task may only exist on this device so far: send it first.
    if ((await db.outbox.where('entityId').equals(todoId).count()) > 0) await engine.sync();

    for (const file of files) {
      if (limit !== undefined) {
        const check = checkFileSize(file.size, limit);
        if (check === 'too_large') {
          setError(t.attachments.tooLarge(file.name, formatSize(limit)));
          continue;
        }
        if (check === 'empty') {
          setError(t.attachments.empty(file.name));
          continue;
        }
      }
      setRunning({ name: file.name, progress: 0 });
      const result = await uploadAttachment(todoId, file, {
        onProgress: (progress) => setRunning({ name: file.name, progress }),
      });
      setRunning(null);
      if (!result.ok) {
        setError(`${file.name}: ${t.attachments.errors[result.error]}`);
        break;
      }
    }
    await reload();
  }

  async function remove(a: Attachment) {
    setError(null);
    if (!(await removeAttachment(a.id))) setError(t.attachments.removeFailed);
    await reload();
  }

  return (
    <section className="attachments" aria-label={t.attachments.title}>
      <h3>{t.attachments.title}</h3>

      {!online && <p className="notice">{t.attachments.needsConnection}</p>}
      {online && loadFailed && <p className="error">{t.attachments.loadFailed}</p>}

      {items !== undefined && items.length === 0 && online && !loadFailed && (
        <p className="hint">{t.attachments.none}</p>
      )}
      {items !== undefined && items.length > 0 && (
        <ul className="attachment-list">
          {items.map((a) => (
            <li key={a.id}>
              <a href={downloadUrl(a.id)} download={a.name} title={t.attachments.download(a.name)}>
                {a.name}
              </a>{' '}
              <span className="hint">{formatSize(a.size)}</span>
              <button
                type="button"
                className="link"
                aria-label={t.attachments.remove(a.name)}
                onClick={() => void remove(a)}
              >
                {t.attachments.removeLabel}
              </button>
            </li>
          ))}
        </ul>
      )}

      {running && (
        <p role="status" className="upload-status">
          {t.attachments.uploading(running.name)}
          <progress
            value={running.progress}
            max={1}
            aria-label={t.attachments.uploading(running.name)}
          />
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <input
        ref={input}
        type="file"
        multiple
        hidden
        data-testid="attachment-input"
        onChange={(e) => void onPick(e)}
      />
      <button
        type="button"
        disabled={!online || running !== null}
        onClick={() => input.current?.click()}
      >
        {t.attachments.add}
      </button>
      {max !== undefined && <p className="hint">{t.attachments.maxSize(formatSize(max))}</p>}
    </section>
  );
}
