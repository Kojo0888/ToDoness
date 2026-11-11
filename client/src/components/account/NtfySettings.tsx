import { useEffect, useState } from 'react';
import { t } from '../../app/strings';
import { SettingRow } from '../common/SettingRow';
import { InfoTip } from '../common/InfoTip';
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
  // Separate, so each button shows its own "working" label; either one disables both.
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const busy = saving || testing;
  const [message, setMessage] = useState<Message>(undefined);
  // Switched on, but no topic saved yet: the setup is open (FR-122).
  const [setupOpen, setSetupOpen] = useState(false);

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
    setSaving(true);
    setMessage(undefined);
    const result = await saveNtfyTopic(topic);
    if (result === 'ok') {
      const trimmed = topic.trim();
      setTopic(trimmed);
      setStatus((s) => (s ? { ...s, topic: trimmed } : s));
      setSetupOpen(false);
      setMessage({ kind: 'info', text: t.settings.ntfy.saved });
    } else {
      setMessage({ kind: 'error', text: err[result] });
    }
    setSaving(false);
  }

  async function turnOff() {
    setSaving(true);
    setMessage(undefined);
    if (await removeNtfyTopic()) {
      setTopic('');
      setStatus((s) => (s ? { ...s, topic: null } : s));
      setMessage({ kind: 'info', text: t.settings.ntfy.removed });
    } else {
      setMessage({ kind: 'error', text: err.failed });
    }
    setSaving(false);
  }

  async function test() {
    setTesting(true);
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
                  : result === 'rate_limited'
                    ? err.rateLimited
                    : err.testFailed,
          },
    );
    setTesting(false);
  }

  const on = Boolean(status.topic) || setupOpen;

  async function change(next: boolean) {
    setMessage(undefined);
    if (next) {
      setSetupOpen(true);
      return;
    }
    setSetupOpen(false);
    if (status?.topic) await turnOff();
  }

  return (
    <SettingRow
      title={t.settings.ntfy.title}
      info={t.settings.ntfy.text}
      checked={on}
      disabled={busy}
      onChange={(v) => void change(v)}
      status={status.topic ? t.settings.ntfy.active : on ? undefined : t.settings.ntfy.inactive}
    >
      {on && (
        <>
          <label>
            <span className="title-row">
              {t.settings.ntfy.topicLabel}
              <InfoTip
                text={t.settings.ntfy.topicInfo}
                label={t.common.moreInfo(t.settings.ntfy.topicLabel)}
              />
            </span>
            <input
              value={topic}
              maxLength={64}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setTopic(e.target.value)}
            />
          </label>
          <p className="button-row">
            <button type="button" disabled={busy} onClick={() => setTopic(randomNtfyTopic())}>
              {t.settings.ntfy.generate}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || topic.trim() === '' || topic.trim() === status.topic}
              onClick={() => void save()}
            >
              {saving ? t.settings.ntfy.saving : t.settings.ntfy.save}
            </button>
          </p>
        </>
      )}
      {status.topic && status.url && (
        <>
          <p>{t.settings.ntfy.subscribe(ntfySubscribeUrl(status.url, status.topic))}</p>
          <p>
            <button type="button" disabled={busy} onClick={() => void test()}>
              {testing ? t.settings.ntfy.testing : t.settings.ntfy.test}
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
    </SettingRow>
  );
}
