import type { DeadLetter } from '../../data/db';
import { dismissRefused } from '../../app/publicHooks';
import { t } from '../../app/strings';

const time = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * What a public page says about offline use (docs/notes/PRD.md FR-106 – FR-109): the copy is
 * from earlier, changes are waiting, or some changes were refused by the server.
 */
export function PublicQueueNotice({
  offline,
  at,
  pending,
  refused,
}: {
  offline: boolean;
  at: number | null;
  pending: number;
  refused: DeadLetter[];
}) {
  return (
    <>
      {offline && at !== null && <p className="notice">{t.publicPage.offlineCopy(time(at))}</p>}
      {pending > 0 && (
        <p className="hint" role="status">
          {t.publicPage.pending(pending)}
        </p>
      )}
      {refused.length > 0 && (
        <p className="error public-queue" role="alert">
          {t.publicPage.refused(refused.length)}{' '}
          <button type="button" className="link" onClick={() => void dismissRefused(refused)}>
            {t.publicPage.dismiss}
          </button>
        </p>
      )}
    </>
  );
}
