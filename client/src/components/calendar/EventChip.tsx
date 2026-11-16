import { Link } from 'wouter';
import type { CalItem } from './items';

/** One event (or due task) as a bar in a month cell or a week column. */
export function EventChip({ item, showTime = true }: { item: CalItem; showTime?: boolean }) {
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      title={item.label}
      className={`cal-ev ${item.kind === 'task' ? 'cal-task' : `cal-${item.color}`}`}
    >
      {showTime && item.startTime !== null && <span className="cal-ev-time">{item.startTime}</span>}
      {item.title}
    </Link>
  );
}
