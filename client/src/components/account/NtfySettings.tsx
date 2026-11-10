import { useEffect, useState } from 'react';
import { t } from '../../app/strings';
import {
  loadNtfyStatus,
  ntfySubscribeUrl,
  randomNtfyTopic,
  removeNtfyTopic,
  saveNtfyTopic,
  sendNtfyTest,
  type NtfyStatus,
} from '../../services/ntfy';

type Message = { kind: 'info' | 'error'; text: string } | undefined;

/** Settings card for reminders through ntfy. Hidden when the server has ntfy switched off. */
export function NtfySettings() {
  const [status, setStatus] = useState<NtfyStatus | undefined>(undefined);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(undefined);

  useEffect(() => {
    let cancelled = false;
    void loadNtfyStatus().then((s) => {
      if (cancelled || !s) return;
      setStatus(s);
      setTopic(s.topic ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status?.enabled) return null;

  const err = t.settings.ntfy.error;

  async function save() {
    setBusy(true);
    setMessage(undefined);
    const result = await saveNtfyTopic(topic);
    if (result === 'ok') {
      const trimmed = topic.trim();
      setTopic(trimmed);
      setStatus((s) => (s ? { ...s, topic: trimmed } : s));
      setMessage({ kind: 'info', text: t.settings.ntfy.saved });
    } else {
      setMessage({ kind: 'error', text: err[result] });
    }
    setBusy(false);
  }

  async function turnOff() {
    setBusy(true);
    setMessage(undefined);
    if (await removeNtfyTopic()) {
      setTopic('');
      setStatus((s) => (s ? { ...s, topic: null } : s));
      setMessage({ kind: 'info', text: t.settings.ntfy.removed });
    } else {
      setMessage({ kind: 'error', text: err.failed });
    }
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    setMessage(undefined);
    const result = await sendNtfyTest();
    setMessage(
      result === 'ok'
        ? { kind: 'info', text: t.settings.ntfy.testSent }
        : {
            kind: 'error',
            text:
              result === 'no_topic'
                ? err.noTopic
                : result === 'disabled'
                  ? err.disabled
                  : err.testFailed,
          },
    );
    setBusy(false);
  }

  return (
    <section className="card notifications" aria-label={t.settings.ntfy.title}>
      <h3>{t.settings.ntfy.title}</h3>
      <p>{t.settings.ntfy.text}</p>
      <p role="status">{status.topic ? t.settings.ntfy.active : t.settings.ntfy.inactive}</p>
      <label>
        {t.settings.ntfy.topicLabel}
        <input
          value={topic}
          maxLength={64}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setTopic(e.target.value)}
        />
      </label>
      <p>
        <button type="button" disabled={busy} onClick={() => setTopic(randomNtfyTopic())}>
          {t.settings.ntfy.generate}
        </button>{' '}
        <button
          type="button"
          className="primary"
          disabled={busy || topic.trim() === ''}
          onClick={() => void save()}
        >
          {busy ? t.settings.ntfy.saving : t.settings.ntfy.save}
        </button>
      </p>
      {status.topic && status.url && (
        <>
          <p>{t.settings.ntfy.subscribe(ntfySubscribeUrl(status.url, status.topic))}</p>
          <p>
            <button type="button" disabled={busy} onClick={() => void test()}>
              {busy ? t.settings.ntfy.testing : t.settings.ntfy.test}
            </button>{' '}
            <button type="button" disabled={busy} onClick={() => void turnOff()}>
              {t.settings.ntfy.remove}
            </button>
          </p>
        </>
      )}
      {message && (
        <p
          className={message.kind === 'error' ? 'error' : undefined}
          role={message.kind === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
      <p className="hint">{t.settings.ntfy.hint}</p>
    </section>
  );
}
