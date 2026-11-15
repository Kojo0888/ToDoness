import { Link } from 'wouter';
import { agendaGroups } from '../../lib/calendarGrid';
import { t } from '../../app/strings';
import { dayLong, timeText } from './format';
import type { CalItem } from './items';

/** The events of one day as rows: time, colour bar, title, place (FR-212). */
export function AgendaRows({
  day,
  today,
  events,
}: {
  day: string;
  today: string;
  events: CalItem[];
}) {
  return (
    <section className="cal-day" aria-label={dayLong(day)}>
      <h3 className={day === today ? 'is-today' : undefined}>
        {day === today && <span>{t.calendar.today} · </span>}
        {dayLong(day)}
      </h3>
      {events.length === 0 ? (
        <p className="empty">{t.calendar.nothingPlanned}</p>
      ) : (
        <ul className="cal-rows">
          {events.map((item) => (
            <li key={item.key}>
              <Link href={item.href} aria-label={item.label} className="cal-row">
                <span className="cal-row-time">{timeText(item)}</span>
                <span
                  className={`cal-row-bar ${item.kind === 'task' ? 'cal-task' : `cal-${item.color}`}`}
                  aria-hidden="true"
                />
                <span className="cal-row-what">
                  {item.title}
                  {item.detail && <small>{item.detail}</small>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The days with something on them from `from` on; today is always listed (FR-212). */
export function AgendaView({
  from,
  to,
  today,
  items,
}: {
  from: string;
  to: string;
  today: string;
  items: CalItem[];
}) {
  const groups = agendaGroups(items, from, to, today);
  return (
    <div className="cal-agenda">
      {groups.length === 0 ? (
        <p className="empty">{t.calendar.nothingPlanned}</p>
      ) : (
        groups.map((g) => <AgendaRows key={g.day} day={g.day} today={today} events={g.events} />)
      )}
    </div>
  );
}
