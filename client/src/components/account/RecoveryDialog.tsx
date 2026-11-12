import { useEffect, useRef, useState } from 'react';
import { recovery } from '../../app/container';
import { useRecoveryOffer, useSyncStatus } from '../../app/hooks';
import { t } from '../../app/strings';
import { isAccountEmpty } from '../../services/recovery';

/**
 * Shown after logging in on a device that still holds the data of an old account (the
 * server lost its database, docs/v1/PRD.md FR-77 – FR-82). On an empty account it asks
 * *Upload my data* / *Keep it empty*; on an account that holds other data it asks *Which data
 * is newer?* (docs/recovery-upload FR-163 – FR-170). The same data asks nothing: the service
 * drops it. Escape does not answer: the answers are deliberate, and the question comes back
 * after a reload until one is given.
 */
export function RecoveryDialog() {
  const offer = useRecoveryOffer();
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'no_inbox' | 'failed' | null>(null);

  // Read when the app opens, and again after every sync: what the account holds can change
  // (another device, or the first pull after a reload), and the popup must not say "empty"
  // when it is not, nor ask about data that is now the same.
  const { lastSyncAt } = useSyncStatus();
  useEffect(() => {
    void recovery.load().catch(() => undefined);
  }, [lastSyncAt]);

  const open = offer !== undefined;
  const empty = offer !== undefined && isAccountEmpty(offer);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function run(
    action: () => Promise<{ ok: boolean; error?: 'no_offer' | 'no_inbox' } | void>,
  ) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result && !result.ok && result.error === 'no_inbox') setError('no_inbox');
    } catch {
      setError('failed');
    } finally {
      setBusy(false);
    }
  }

  /** The device's data goes to the server: added to an empty account, replacing otherwise. */
  const takeDevice = () =>
    // Nothing to overwrite on an empty account: append (decision U1).
    run(() => recovery.accept(empty ? 'append' : 'overwrite'));
  /** The server's data stays (or the account stays empty); the device's copy is deleted. */
  const takeServer = () => run(() => recovery.decline());

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="recovery-title"
      onCancel={(e) => e.preventDefault()}
    >
      {offer && empty && (
        <>
          <h2 id="recovery-title">{t.recovery.title}</h2>
          <p>{t.recovery.emptyAccount(offer.fromEmail, offer)}</p>
          <p>
            <strong>{t.recovery.question}</strong>
          </p>
          <p className="hint">{t.recovery.attachments}</p>
          <p className="hint">{t.recovery.noWarning}</p>
          {busy && <p role="status">{t.recovery.working}</p>}
          {error && <p role="alert">{t.recovery.errors[error]}</p>}
          <div className="dialog-actions">
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void takeServer()}
            >
              {t.recovery.keepEmpty}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void takeDevice()}
            >
              {t.recovery.upload}
            </button>
          </div>
        </>
      )}
      {offer && !empty && (
        <>
          <h2 id="recovery-title">{t.recovery.differsTitle}</h2>
          <p>
            {t.recovery.differs(offer.fromEmail, offer, {
              todos: offer.accountTodos,
              lists: offer.accountLists,
              notes: offer.accountNotes,
              plans: offer.accountPlans,
            })}
          </p>
          <p>
            <strong>{t.recovery.newerQuestion}</strong>
          </p>
          <p className="hint">{t.recovery.serverNewerHint}</p>
          <p className="hint">{t.recovery.deviceNewerHint}</p>
          <p className="hint">{t.recovery.attachments}</p>
          {busy && <p role="status">{t.recovery.working}</p>}
          {error && <p role="alert">{t.recovery.errors[error]}</p>}
          {/* Both answers delete one side's data, so neither is styled as the main or the
              destructive one (exception to UI_GUIDELINES, docs/recovery-upload FR-169). */}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={() => void takeServer()}>
              {t.recovery.serverNewer}
            </button>
            <button type="button" disabled={busy} onClick={() => void takeDevice()}>
              {t.recovery.deviceNewer}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
