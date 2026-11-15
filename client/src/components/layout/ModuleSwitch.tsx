import { Link } from 'wouter';
import { MODULES, type ModuleId } from '../../lib/modules';
import { useModule } from '../../app/hooks';
import { t } from '../../app/strings';

const ICONS: Record<ModuleId, string> = {
  // A check mark in a box.
  tasks: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM8 12l3 3 5-6',
  // A page with lines.
  notes: 'M6 3h9l4 4v14H6zM15 3v4h4M9 11h7M9 15h7',
  // Three bars of a timeline, each starting later.
  plan: 'M4 6h8M9 12h8M13 18h7',
  // A calendar page with two rings.
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
};

/**
 * The module picker (docs/calendar/PRD.md FR-201): every module with its icon and full name.
 * `rail` is the vertical list at the top of the sidebar on a computer; `tabbar` is the bar at
 * the bottom of the screen on a phone (CSS shows one of them). A labelled group of links, so it
 * is one tap away and works with the keyboard; more modules only add entries to `MODULES`.
 */
export function ModuleSwitch({
  variant,
  onNavigate,
}: {
  variant: 'rail' | 'tabbar';
  onNavigate?: () => void;
}) {
  const { current, onModulePage, hrefOf } = useModule();
  return (
    <div
      className={`module-switch ${variant === 'rail' ? 'module-rail' : 'tabbar'}`}
      role="group"
      aria-label={t.modules.label}
    >
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
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
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
