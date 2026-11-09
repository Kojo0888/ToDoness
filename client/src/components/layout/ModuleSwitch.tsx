import { Link } from 'wouter';
import { MODULES, type ModuleId } from '../../lib/modules';
import { useModule } from '../../app/hooks';
import { t } from '../../app/strings';

const ICONS: Record<ModuleId, string> = {
  // A check mark in a box.
  tasks: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM8 12l3 3 5-6',
  // A page with lines.
  notes: 'M6 3h9l4 4v14H6zM15 3v4h4M9 11h7M9 15h7',
};

/**
 * Tasks | Notes (docs/notes/PRD.md FR-83). Shown at the top of the sidebar on a computer
 * and in the top bar on a phone (CSS picks one). A labelled group of links, so it is one
 * tap away and works with the keyboard; more modules only add entries to `MODULES`.
 */
export function ModuleSwitch({ onNavigate }: { onNavigate?: () => void }) {
  const { current, onModulePage, hrefOf } = useModule();
  return (
    <div className="module-switch" role="group" aria-label={t.modules.label}>
      {MODULES.map((m) => {
        const active = m.id === current;
        return (
          <Link
            key={m.id}
            href={hrefOf(m.id)}
            className={active ? 'active' : ''}
            aria-current={active ? (onModulePage ? 'page' : 'true') : undefined}
            onClick={onNavigate}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path
                d={ICONS[m.id]}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>{t.modules[m.id]}</span>
          </Link>
        );
      })}
    </div>
  );
}
