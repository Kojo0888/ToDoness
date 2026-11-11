import { useId, type ReactNode } from 'react';
import { t } from '../../app/strings';
import { InfoTip } from './InfoTip';

/**
 * One on/off setting: title, "i" info button and a switch on the right; an optional status
 * line and content below (docs/note-lists FR-119). Every notification channel uses it, so
 * they all look and work the same.
 */
export function SettingRow({
  title,
  info,
  checked,
  disabled,
  onChange,
  status,
  statusKind = 'info',
  children,
}: {
  title: string;
  info: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  status?: string;
  statusKind?: 'info' | 'error';
  children?: ReactNode;
}) {
  const titleId = useId();
  const infoId = useId();
  return (
    <section className="card setting" aria-labelledby={titleId}>
      <div className="setting-row">
        <h3 id={titleId}>{title}</h3>
        <InfoTip text={info} label={t.common.moreInfo(title)} id={infoId} />
        <span className="switch setting-switch">
          <input
            type="checkbox"
            role="switch"
            aria-labelledby={titleId}
            aria-describedby={infoId}
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
        </span>
      </div>
      {status && (
        <p
          className={`setting-status${statusKind === 'error' ? ' error' : ''}`}
          role={statusKind === 'error' ? 'alert' : 'status'}
        >
          {status}
        </p>
      )}
      {children}
    </section>
  );
}
