import { useEffect, useRef, useState } from 'react';
import { recovery } from '../../app/container';
import { useRecoveryOffer, useSyncStatus } from '../../app/hooks';
import { t } from '../../app/strings';
import type { RestoreMode } from '../../data/recovery';
import { isAccountEmpty } from '../../services/recovery';

/**
 * Shown after signing up on a device that still holds the data of an old account (the
 * server lost its database). Asks "Upload my data" or "Keep it empty"; on an account that is
 * not empty, uploading then asks whether to overwrite or append (docs/v1/PRD.md FR-78 –
 * FR-82, docs/recovery-upload FR-163 – FR-165). Escape does not answer: both answers are
 * deliberate, and the question comes back after a reload until one is given.
 */
export function RecoveryDialog() {
  const offer = useRecoveryOffer();
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<'ask' | 'choose'>('ask');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'no_inbox' | 'failed' | null>(null);

  // Read when the app opens, and again after every sync: what the account holds can change
  // (another device, or the first pull after a reload), and the popup must not say "empty"
  // when it is not.
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
      else setStep('ask'); // answered: the next question (if any) starts from the beginning
    } catch {
      setError('failed');
    } finally {
      setBusy(false);
    }
  }

  const accept = (mode: RestoreMode) => run(() => recovery.accept(mode));
  const decline = () => run(() => recovery.decline());

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="recovery-title"
      onCancel={(e) => e.preventDefault()}
    >
      {offer && step === 'ask' && (
        <>
          <h2 id="recovery-title">{t.recovery.title}</h2>
          <p>
            {empty
              ? t.recovery.emptyAccount(offer.fromEmail, offer)
              : t.recovery.filledAccount(offer.fromEmail, offer, {
                  todos: offer.accountTodos,
                  notes: offer.accountNotes,
                  plans: offer.accountPlans,
                })}
          </p>
          <p>
            <strong>{t.recovery.question}</strong>
          </p>
          <p className="hint">{t.recovery.attachments}</p>
          <p className="hint">{t.recovery.noWarning}</p>
          {busy && <p role="status">{t.recovery.working}</p>}
          {error && <p role="alert">{t.recovery.errors[error]}</p>}
          <div className="dialog-actions">
            <button type="button" className="danger" disabled={busy} onClick={() => void decline()}>
              {empty ? t.recovery.keepEmpty : t.recovery.dontUpload}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              // Nothing to overwrite on an empty account: upload at once (FR-164, decision U1).
              onClick={() => (empty ? void accept('append') : setStep('choose'))}
            >
              {t.recovery.upload}
            </button>
          </div>
        </>
      )}
      {offer && step === 'choose' && (
        <>
          <h2 id="recovery-title">{t.recovery.chooseTitle}</h2>
          <p>{t.recovery.chooseText}</p>
          {busy && <p role="status">{t.recovery.working}</p>}
          {error && <p role="alert">{t.recovery.errors[error]}</p>}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={() => setStep('ask')}>
              {t.recovery.back}
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void accept('overwrite')}
            >
              {t.recovery.overwrite}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void accept('append')}
            >
              {t.recovery.append}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
